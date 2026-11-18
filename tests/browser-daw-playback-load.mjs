// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/daw-mvp-wave-4',full=process.env.DAW_PLAYBACK_FULL==='1';fs.mkdirSync(root,{recursive:true});const profile=fs.mkdtempSync(path.join(os.tmpdir(),'waswan-daw-pcm-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=context.pages()[0]||await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log(m.text());});page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{window.audit={contexts:0,hosts:0,dsp:[],audioErrors:[]};const AC=AudioContext;window.AudioContext=class extends AC{constructor(...a){super(...a);audit.context=this;audit.contexts++;}};const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...a){super(...a);if(a[1]==='obervave-smk37'){audit.node=this;audit.hosts++;this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;if(m.t==='daw-state')audit.state=m;if(m.t==='dsp-window')audit.dsp.push(m);if(m.t==='error')audit.audioErrors.push(m.message);});}}};window.showOpenFilePicker=async()=>[audit.handle];});
 await page.goto('http://localhost:8737/simulator/?workspace=daw');await page.getByRole('button',{name:'Start audio',exact:true}).click();await page.waitForFunction(()=>audit.frame?.ms>5000);await page.locator('.ww-midi-setup').getByRole('button',{name:'OK',exact:true}).click();
 await page.evaluate(async full=>{
  const {emptyProject,makeTrack,uuid}=await import('/simulator/daw-project.js'),{projectBlob}=await import('/simulator/daw-format.js'),{wavHeader}=await import('/simulator/studio-format.js'),{DawPlayer}=await import('/simulator/daw-player.js'),{effect}=await import('/simulator/daw-fx-catalog.js');const p=emptyProject(),assets=new Map(),frames=300*44100;p.name='Eight tracks five minutes';p.length=600*960;
  const request=crypto.randomUUID(),reply=new Promise(resolve=>{const receive=({data:m})=>{if(m.t==='daw-reply'&&m.request===request){audit.node.port.removeEventListener('message',receive);resolve(m.result);}};audit.node.port.addEventListener('message',receive);});audit.node.port.postMessage({t:'daw-program',request,program:64});const sound=await reply;
  for(let i=0;i<3;i++){const t=makeTrack('midi','Instrument '+i);t.instrument={type:'analog',patch:[...sound.patch]};if(full)t.fx=[effect('compressor')];p.tracks.push(t);p.clips.push({id:uuid(),type:'midi',trackId:t.id,name:t.name,position:{unit:'ticks',value:0},length:p.length,loopLength:p.length,loop:false,notes:Array.from({length:600},(_,n)=>({id:uuid(),pitch:48+i*7+n%4,velocity:60,start:n*960,duration:480}))});}
  for(let i=0;i<5;i++){const t=makeTrack('audio','Stem '+i),id=uuid(),block=Int16Array.from({length:88200},(_,n)=>Math.round(Math.sin(n*.07+i)*512)),source=new Blob([wavHeader(frames),...Array(300).fill(block)]);t.volume=.5;if(full)t.fx=[effect(['eq','delay','chorus','saturation','reverb'][i])];p.tracks.push(t);p.assets.push({id,name:t.name,sampleRate:44100,channels:2,frames,bytes:source.size});assets.set(id,source);p.clips.push({id:uuid(),type:'audio',trackId:t.id,name:t.name,assetId:id,position:{unit:'seconds',value:0},offset:0,frames,gain:1,pan:0,fadeIn:0,fadeOut:0});}
  if(full)p.master.fx=[effect('eq'),effect('limiter')];
  const dir=await navigator.storage.getDirectory();audit.handle=await dir.getFileHandle('playback-load.wsproj',{create:true});const writer=await audit.handle.createWritable();await writer.write(await projectBlob(p,assets));await writer.close();const start=DawPlayer.prototype.start;DawPlayer.prototype.start=function(controller,...rest){audit.player=this;audit.controller=controller;return start.call(this,controller,...rest);};
 },full);
 const daw=page.locator('.ww-daw'),button=name=>daw.getByRole('button',{name,exact:true});await button('Open DAW project').click();await page.waitForFunction(()=>document.querySelectorAll('.ww-daw-track').length===8,null,{timeout:120000});const before=Date.now();await button('Play DAW').click();await page.waitForFunction(()=>audit.player?.playing,null,{timeout:120000});const coldPlayMs=Date.now()-before;
 await page.waitForTimeout(1500);
 let durationReport={fullDurationRun:false};
 if(full){
  await page.evaluate(()=>{
   audit.invalidMaster=false;
   audit.node.port.postMessage({t:'dsp-control',action:'start',session:'daw-playback-load'});
   audit.check=setInterval(()=>{if(audit.player.masterLevels?.invalid)audit.invalidMaster=true;},250);
  });
  console.log('Five minute playback started.');
  const timer=setInterval(async()=>{
   try{console.log('Playback frame '+await page.evaluate(()=>audit.state?.frame));}catch{}
  },60000);
  try{await page.waitForFunction(()=>!audit.player.playing,null,{timeout:345000,polling:1000});}finally{clearInterval(timer);}
  durationReport=await page.evaluate(()=>{
   clearInterval(audit.check);
   audit.node.port.postMessage({t:'dsp-control',action:'stop'});
   return {fullDurationRun:true,finalFrame:audit.state?.frame,reason:audit.state?.reason,invalidMaster:audit.invalidMaster,
    dsp:audit.dsp.map(m=>({stats:m.stats,measurement:m.measurement})),audioErrors:audit.audioErrors};
  });
  assert.equal(durationReport.reason,'ended');assert.equal(durationReport.finalFrame,300*44100);
  assert(!durationReport.invalidMaster);assert.deepEqual(durationReport.audioErrors,[]);
 }
 const report=await page.evaluate(async full=>{
  const info=await audit.player.mediaRpc.request('info');let peak=0;for(const track of audit.player.tracks.values()){const samples=new Float32Array(256);track.meter.getFloatTimeDomainData(samples);for(const v of samples){if(!Number.isFinite(v))throw Error('Non-finite audio');peak=Math.max(peak,Math.abs(v));}}
  if(!full)await audit.player.stop();
  const began=performance.now();await audit.player.start(audit.controller,{fromFrame:120*44100,loop:true,loopStart:120*44100,loopEnd:121*44100+19});
  const warmSeekMs=performance.now()-began;
  if(full){await new Promise(resolve=>setTimeout(resolve,500));peak=Math.max(...(audit.player.masterLevels?.peaks||[0]));}
  return {...info,warmSeekMs,contexts:audit.contexts,hosts:audit.hosts,tracks:audit.player.tracks.size,sourceReferences:audit.player.decoded.size,peak};
 },full);assert.equal(report.sources,5);assert.equal(report.pcmBytes,529200000);assert.equal(report.tracks,8);assert.equal(report.contexts,1);assert.equal(report.hosts,1);assert(report.peak>0);await page.waitForTimeout(1500);await button('Stop DAW').click();assert.deepEqual(errors,[]);
 fs.writeFileSync(`${root}/playback-load${full?'-full':''}.json`,JSON.stringify({result:'PASS',coldPlayMs,...report,secondsPerSource:300,...durationReport,physicalValidation:false,totalNativeMemoryMeasured:false,errors},null,2));console.log(JSON.stringify({result:'PASS',coldPlayMs,...report,errors}));
}finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
