// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='.local/validation/studio-wave-4';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.audit={};const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);if(args[1]!=='obervave-smk37')return;audit.node=this;this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});}};
 });
 await page.goto('http://localhost:8737/simulator/');await page.getByRole('button',{name:'Start audio',exact:true}).click();await page.waitForFunction(()=>audit.frame?.ms>5000);await page.locator('.ww-midi-setup').getByRole('button',{name:'OK',exact:true}).click();
 await page.evaluate(async()=>{
  audit.node.port.postMessage({t:'voice-mode',part:0,mode:0});for(const n of [48,52,55,60])audit.node.port.postMessage({t:'midi',st:144,d1:n,d2:100});
  audit.analyser=audit.context.createAnalyser();audit.node.connect(audit.analyser);
  const {wavHeader,MAX_FRAMES}=await import('./studio-format.js');
  // A one-second generated PCM block is reused in a virtual 20-minute Blob.
  const data=new ArrayBuffer(44100*4),view=new DataView(data);for(let i=0;i<44100;i++){const value=Math.round(Math.sin(i*2*Math.PI*440/44100)*8000);view.setInt16(i*4,value,true);view.setInt16(i*4+2,value,true);}
  const second=new Blob([data]),audio=new Blob([wavHeader(MAX_FRAMES),...Array(1200).fill(second)]);
  audit.worker=new Worker('studio-mp3-worker.js');audit.worker.onmessage=({data:m})=>{if(m.t==='progress')audit.progress=m.frames;if(m.t==='finished')audit.mp3=m.audio;if(m.t==='error')audit.error=m.message;};
  audit.worker.postMessage({t:'encode',audio,frames:MAX_FRAMES});
 });
 const cdp=await context.newCDPSession(page),started=Date.now(),memory=[];
 while(!await page.evaluate(()=>!!audit.mp3||!!audit.error)){
  assert(Date.now()-started<240000,'MP3 encoding exceeded four minutes');await page.waitForTimeout(10000);await cdp.send('HeapProfiler.collectGarbage');memory.push({wallMs:Date.now()-started,...await cdp.send('Runtime.getHeapUsage')});
  console.log(JSON.stringify({status:'encoding',wallSeconds:Math.round((Date.now()-started)/1000),audioSeconds:await page.evaluate(()=>(audit.progress||0)/44100)}));
 }
 assert.equal(await page.evaluate(()=>audit.error),undefined);
 const encoded=await page.evaluate(async()=>{
  const bytes=new Uint8Array(await audit.mp3.arrayBuffer()),rates=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];let offset=0,count=0;
  while(offset<bytes.length){
    const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2];if(a!==255||(b&224)!==224||((b>>3)&3)!==3||((b>>1)&3)!==1||((c>>2)&3)!==0)throw Error('Invalid MPEG frame at '+offset);
    const rate=rates[c>>4];if(rate!==192)throw Error('Unexpected bitrate');offset+=Math.floor(144000*rate/44100)+((c>>1)&1);count++;
  }
  if(offset!==bytes.length)throw Error('Truncated MPEG frame');
  const data=new Float32Array(2048);audit.analyser.getFloatTimeDomainData(data);
  return {bytes:bytes.length,frames:count,duration:count*1152/44100,context:audit.context.state,gated:audit.frame.polyphony.slots.filter(v=>v.gate).length,audioPeak:Math.max(...data.map(Math.abs)),finite:Array.from(data).every(Number.isFinite)};
 });
 assert(Math.abs(encoded.duration-1200)<.15);assert.equal(encoded.context,'running');assert.equal(encoded.gated,4);assert(encoded.audioPeak>0&&encoded.finite);assert.deepEqual(errors,[]);
 if(memory.length>1)assert(memory.at(-1).usedSize-memory[0].usedSize<8*1024*1024);
 const report={result:'PASS',chrome:await browser.version(),sourceSeconds:1200,wallMs:Date.now()-started,encoded,memory,scope:'Every MPEG frame parsed; live synth active; no hardware latency or underrun measurement',physicalValidation:false,errors};fs.writeFileSync(`${root}/mp3-long.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
