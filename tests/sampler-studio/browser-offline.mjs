// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.goto(process.env.SAMPLER_BROWSER_URL || 'http://localhost:8737/simulator/');
  const result=await page.evaluate(async()=>{
    const {runOffline,encodeSample}=await import('./sampler-offline.js');
    const pcm=Float32Array.from({length:48000},(_,i)=>.5*Math.sin(i*2*Math.PI*440/48000));
    const file=encodeSample({pcm,channels:1,sampleRate:48000});
    const {wav}=await runOffline(file,{type:'edit',recipe:[{type:'trim',start:0,end:24000},{type:'rate',sampleRate:44100}]});
    const result=await runOffline(wav,{type:'analyze'});
    const abort=new AbortController();
    const work=runOffline(file,{type:'analyze'},{signal:abort.signal});
    abort.abort();
    return {frames:result.frames,root:result.pitch.root,cancel:await work.then(()=>false,e=>e.name==='AbortError')};
  });
  assert.deepEqual(result,{frames:22050,root:69,cancel:true});
  console.log('PASS browser worker trim, rate conversion, pitch measurement and abort');
}finally{await browser.close();}
