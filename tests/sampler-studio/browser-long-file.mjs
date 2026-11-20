// SPDX-License-Identifier: GPL-3.0-only
// Disk-backed Chrome File benchmark. The simulated prefetch queue runs outside the worklet.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, open, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {wavHeader} from '../../web/studio-format.js';

const dir = await mkdtemp(join(tmpdir(), 'waswan-long-sample-'));
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome', headless:true});
try {
  const name = join(dir,'long-stereo.wav'), frames = 44100 * 420, bytes = frames * 4;
  const file = await open(name, 'w');
  try {
    await file.write(new Uint8Array(wavHeader(frames)));
    const block = Buffer.alloc(65536);
    for (let n=0; n<block.length; n+=4) {
      block.writeInt16LE(Math.round(14000*Math.sin(n/37)),n);
      block.writeInt16LE(Math.round(10000*Math.sin(n/43)),n+2);
    }
    for (let i=0; i<bytes; i+=block.length) await file.write(block.subarray(0,Math.min(block.length,bytes-i)));
  } finally { await file.close(); }
  const page = await browser.newPage();
  await page.setContent('<input type="file">');
  await page.locator('input').setInputFiles(name);
  const result = await page.evaluate(async () => {
    const file = document.querySelector('input').files[0];
    async function probe(file) {
      const pageFrames = 8192, voices = 16;
      const pageBytes = pageFrames*4, pages = Math.floor((file.size-44)/pageBytes);
      const timings = [];
      let fingerprint = 0;
      for (let round=0; round<64; round++) {
        const start = performance.now();
        const queued = Array.from({length:voices},(_,voice)=>{
          const head = round%16 === 0 ? 31*round : (round%27);
          const index = (voice*79 + head*(voice%2===0 ? 1 : -1) + pages)%pages;
          const position = 44+index*pageBytes;
          return file.slice(position,position+pageBytes).arrayBuffer();
        });
        const blocks = await Promise.all(queued);
        for (const block of blocks) fingerprint += new Int16Array(block)[31];
        timings.push(performance.now()-start);
      }
      const firstBatchMs = timings[0];
      timings.sort((a,b)=>a-b);
      const start = performance.now();
      const all = await file.arrayBuffer();
      const wholeReadMs = performance.now()-start;
      const allowanceMs = pageFrames/44100*1000/2;
      return {bytes:all.byteLength-44,seconds:420,voices,pageFrames,queueBytes:2*voices*pageBytes,
        firstBatchMs,p50Ms:timings[31],p99Ms:timings[63],maxMs:timings.at(-1),wholeReadMs,
        allowanceMs,lateBatches:timings.filter(ms=>ms>=allowanceMs).length,
        residentLimit:64*1024*1024, fingerprint};
    }
    const script = 'onmessage = async ({data}) => postMessage(await ('+probe.toString()+')(data));';
    const url = URL.createObjectURL(new Blob([script],{type:'text/javascript'}));
    const worker = new Worker(url);
    try {
      return await new Promise((resolve,reject)=>{
        worker.onmessage = event => resolve(event.data);
        worker.onerror = event => reject(Error(event.message));
        worker.postMessage(file);
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  });
  assert.equal(result.bytes, bytes);
  assert(result.bytes>result.residentLimit && result.fingerprint!==0);
  const out=process.env.SAMPLER_VALIDATION_ROOT || '.local/validation/sampler-studio-5';
  await mkdir(out,{recursive:true});
  await writeFile(join(out,'long-file.json'), JSON.stringify({browser:browser.version(),...result},null,2));
  console.log('PASS disk-backed Chrome prefetch comparison',JSON.stringify(result));
} finally {
  await browser.close();
  await rm(dir,{recursive:true,force:true});
}
