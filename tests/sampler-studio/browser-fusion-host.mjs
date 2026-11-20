// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('.local/validation/sampler-ux-4',{recursive:true});

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
 const page=await browser.newPage();
 await page.addInitScript(()=>{
   window.audit={contexts:0,hosts:0};
   const AC=AudioContext, AW=AudioWorkletNode;
   window.AudioContext=class extends AC{constructor(...args){super(...args);audit.contexts++;}};
   window.AudioWorkletNode=class extends AW{constructor(...args){super(...args);if(args[1]==='obervave-smk37'){
     audit.hosts++;this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});
   }}};
 });
 await page.goto('http://localhost:8737/simulator/?workspace=daw');
 await startSynth(page);
 await page.evaluate(async()=>{const {DawMix}=await import('./ui-daw-mix.js');const fn=DawMix.prototype.refresh;
   DawMix.prototype.refresh=function(...args){audit.w=this.w;return fn.apply(this,args);};});
 await page.getByRole('button',{name:'Add MIDI track',exact:true}).click();
 const result=await page.evaluate(async()=>{
   const w=audit.w,p=w.player, active=w.controller, exp=w.audioExport.exporter;
   const {emptyProject,makeTrack,uuid,PPQ,RATE}=await import('./daw-project.js');
   const {captureFusion,openFusionMonitor}=await import('./sampler-fusion.js');
   const {initializeLibrary,importOriginal,publish}=await import('./sampler-library.js');
   const {mapSample,prepareSampler}=await import('./sampler.js');
   const {encodeSample}=await import('./sampler-offline.js');
   const {decodeWav}=await import('./sampler-wav.js');
   const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('fusion-probe',{create:true});
   await initializeLibrary(dir);
   const project=emptyProject();project.name='Probe';project.length=PPQ;project.transport.end=PPQ;
   for(const [i,freq] of [220,517].entries()){
     const src=await importOriginal(dir,encodeSample({sampleRate:RATE,channels:1,
       pcm:Float32Array.from({length:RATE},(_,i)=>.3*Math.sin(i*2*Math.PI*freq/RATE))}),'Samples/Originals/'+freq+'.wav');
     const model=mapSample(src,60,{name:String(freq)});model.envelope={attackMs:1,decayMs:1,sustain:1,releaseMs:300};
     const ref=await publish(dir,model,{path:'Instruments/tone'+freq,expectedRevision:0});
     const track=makeTrack('midi','sine'+freq); track.instrument=await prepareSampler(p,dir,ref);track.volume=.7;track.pan=i?1:-1;
     project.tracks.push(track);
     project.clips.push({type:'midi',id:uuid(),trackId:track.id,name:'test',position:{unit:'ticks',value:0},
       length:PPQ,loopLength:PPQ,loop:false,notes:[{id:uuid(),pitch:60,velocity:115,start:0,duration:PPQ/2}]});
   }
   const sources=project.tracks.map(({id,name,instrument,volume,pan,fx})=>({id,name,instrument,volume,pan,fx}));
   const options={name:'Bell mix',notes:[60],velocities:[100],duration:.25,release:.23,tail:0};
   const before=JSON.stringify(active.snapshot());
   const first=await captureFusion(w,dir,sources,options);
   const emptyRestored=p.tracks.size===0 && !p.exporting && !w.busy;
   const {readSampleFile}=await import('./sampler-library.js');
   const wav=await decodeWav(await readSampleFile(dir,first.draft.source));
   function magnitude(hz,ch,start,count){
     let re=0,im=0;for(let i=0;i<count;i++){const angle=2*Math.PI*hz*i/RATE,value=wav.pcm[(i+start)*2+ch]/32768;
       re+=value*Math.cos(angle);im+=value*Math.sin(angle);}return Math.hypot(re,im)*2/count;
   }
   await p.prepareLive(active);
   const beforeTracks=[...p.tracks.keys()],beforeBindings=[...p.slots];
   const monitor=await openFusionMonitor(w,sources);
   const readHeld=async()=>(await p.requests().request('daw-state-request',{exportToken:p.exporting.token})).liveHeld.slice(4,6);
   const note=(owner,note,velocity)=>monitor.note({owner,channel:1,note,velocity});
   await note('controller',60,104);await note('virtual',60,68);
   const both=await readHeld();
   await monitor.pedal({owner:'controller',channel:1,down:true});
   await note('controller',60,0);
   await monitor.setSources(sources.map((s,i)=>({...s,key:i?[0,127]:[70,127]})));
   await note('virtual',60,0);
   const sustained=await readHeld();
   await monitor.pedal({owner:'controller',channel:1,down:false});
   await note('controller',60,90);
   const changed=await readHeld();
   await monitor.releaseOwner('controller');
   const released=await readHeld();
   let occupied;
   try{await captureFusion(w,dir,sources,options);}catch(e){occupied=e.message;}
   await monitor.close();
   const restored=JSON.stringify(beforeTracks)===JSON.stringify([...p.tracks.keys()])&&
     JSON.stringify(beforeBindings)===JSON.stringify([...p.slots]);
   const failure=await openFusionMonitor(w,sources);
   try {await failure.note({owner:'bad',channel:34,note:10,velocity:80});}catch{}
   await failure.closed;
   const {compile,explainNote}=await import('./sampler-instrument.js');
   const multi={name:'Short roots',mode:'multi',notes:[57,64],velocities:[45,100],repeats:2,
     duration:.06,sustain:.02,release:.1,tail:0};
   const bank=await captureFusion(w,dir,[sources[0]],multi);
   const plan=compile(bank.draft.instrument),firstHit=explainNote(plan,{type:'noteOn',note:64,velocity:90});
   const secondHit=explainNote(plan,{type:'noteOn',note:64,velocity:90},firstHit.state);
   const abort=new AbortController();
   let partial;
   try{
     await captureFusion(w,dir,sources,{...multi,signal:abort.signal,onProgress:({completed})=>{
       if(completed===1)abort.abort();
     }});
   }catch(e){partial={error:e.name,count:e.completedTakes.length};}
   const result={frames:wav.frames,peak:first.report.peak,emptyRestored,restored,both,sustained,changed,released,occupied,
     multi:bank.report,rr:[firstHit,secondHit].map(hit=>hit.voices.map(v=>v.regionId)),partial,
     actualSourceCount:first.draft.source.provenance.fusion.sources.length,unchanged:before===JSON.stringify(active.snapshot()),
     releasedOnFailure:!p.exporting&&!w.busy,contexts:audit.contexts,hosts:audit.hosts,
     left220:magnitude(220,0,2304,4096),right517:magnitude(517,1,2304,4096),
     release220:magnitude(220,0,12344,2048)};
   return result;
 });
 assert(result.emptyRestored && result.restored && result.unchanged && result.releasedOnFailure);
 assert.equal(result.hosts,1);assert.equal(result.contexts,1);assert.equal(result.actualSourceCount,2);
 assert(result.left220>.1 && result.right517>.1 && result.release220>.05 && result.peak<1);
 assert.deepEqual(result.both,[2,2]);assert.deepEqual(result.sustained,[1,1]);
 assert.deepEqual(result.changed,[0,1]);assert.deepEqual(result.released,[0,0]);
 assert.match(result.occupied,/Finish|Stop/);
 assert.equal(result.multi.completed,8);
 assert.equal(result.multi.total,8);
 assert.deepEqual(result.rr,[['n064-v100-t001'],['n064-v100-t002']]);
 assert.deepEqual(result.partial,{error:'AbortError',count:1});
 await writeFile('.local/validation/sampler-ux-4/fusion-host.json',JSON.stringify(result,null,2));
 console.log('PASS real-time Fusion keyboard ownership, sustain, cancellation, project and mixer restoration and single stereo capture',result);
}finally{await browser.close();}
