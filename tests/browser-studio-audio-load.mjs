// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='.local/validation/studio-wave-5';fs.mkdirSync(root,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);window.audioContext=this;}};const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);if(args[1]==='obervave-smk37'){window.instrument=this;this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')window.frame=m;});}}};});await page.goto('http://localhost:8737/simulator/');await page.getByRole('button',{name:'Start audio',exact:true}).click();await page.waitForFunction(()=>window.frame?.ms>5000);await page.locator('.ww-midi-setup').getByRole('button',{name:'OK',exact:true}).click();
 const result=await page.evaluate(async()=>{
  const {wavHeader}=await import('./studio-format.js'),{MAX_ASSET_FRAMES}=await import('./studio-audio.js');
  const request=(data)=>new Promise((resolve,reject)=>{const w=new Worker('./studio-audio-worker.js',{type:'module'});w.onmessage=({data:m})=>{w.terminate();m.t==='error'?reject(Error(m.message)):resolve(m);};w.onerror=()=>reject(Error('worker error'));w.postMessage(data);});
  const frames=44100*30,pcm=new Int16Array(frames*2);for(let i=0;i<frames;i++)pcm[i*2]=pcm[i*2+1]=Math.round(Math.sin(i*2*Math.PI*220/44100)*2048);
  const file=new Blob([wavHeader(frames),pcm]);instrument.port.postMessage({t:'voice-mode',part:0,mode:0});for(const note of [60,64,67,72])instrument.port.postMessage({t:'midi',st:144,d1:note,d2:100});
  const start=performance.now(),assets=[];let ticks=0,maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},10);
  for(let n=0;n<4;n++){const imported=await request({t:'import',file});assets.push({meta:{id:String(n),name:'Load '+n,frames:imported.frames,bytes:imported.audio.size},audio:imported.audio});}
  const sequence={bpm:120,length:960*240,audioClips:[]};for(let n=0;n<8;n++)sequence.audioClips.push({id:'clip'+n,asset:String(n%4),start:n%4*960*60,offset:0,frames,gain:.5,pan:0,mute:false});
  const mixed=await request({t:'mix',sequence,assets});clearInterval(timer);let peak=0;for(const value of mixed.left){if(!Number.isFinite(value))throw Error('Non-finite mix');peak=Math.max(peak,Math.abs(value));}
  const buffer=audioContext.createBuffer(2,mixed.frames,44100);buffer.copyToChannel(mixed.left,0);buffer.copyToChannel(mixed.right,1);const source=audioContext.createBufferSource();source.buffer=buffer;const gain=audioContext.createGain();gain.gain.value=.1;source.connect(gain).connect(audioContext.destination);source.start();source.stop(audioContext.currentTime+.1);
  const invalid=structuredClone(sequence);invalid.audioClips.push({...invalid.audioClips[0],id:'over-budget'});let rejected=false;try{await request({t:'mix',sequence:invalid,assets});}catch(error){rejected=error.message.includes('240 seconds');}
  return {elapsedMs:performance.now()-start,frames:mixed.frames,assets:assets.length,sourceFrames:assets.reduce((n,a)=>n+a.meta.frames,0),expectedSourceFrames:MAX_ASSET_FRAMES,clips:sequence.audioClips.length,peak,timerTicks:ticks,maxMainTimerGapMs:maxGap,budgetRejected:rejected,contextState:audioContext.state,liveGates:frame.polyphony.slots.filter(v=>v.gate&&!v.sequenced).length};
 });
 assert.equal(result.frames,5292000);assert.equal(result.sourceFrames,result.expectedSourceFrames);assert.equal(result.assets,4);assert.equal(result.clips,8);assert(result.peak>.01);assert(result.timerTicks>0);assert(result.budgetRejected);assert.equal(result.contextState,'running');assert.equal(result.liveGates,4);assert.deepEqual(errors,[]);const report={result:'PASS',chrome:await browser.version(),...result,physicalValidation:false,errors};fs.writeFileSync(`${root}/audio-load.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
