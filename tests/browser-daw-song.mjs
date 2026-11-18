// SPDX-License-Identifier: GPL-3.0-only
import {clickDawFile} from './daw-browser-controls.mjs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/daw-mvp-wave-9';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
  page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(()=>{
    window.audit={};
    audit.port={id:'song-controller',name:'Song controller',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.port.id,audit.port]])});
    showSaveFilePicker=async()=>audit.file;
    showOpenFilePicker=async()=>[audit.file];
  });
  await page.goto('http://localhost:8737/simulator/?workspace=daw');
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  const setup=page.locator('.ww-midi-setup');
  await setup.getByRole('button',{name:'Connect MIDI keyboard',exact:true}).click();
  await page.waitForFunction(()=>!!audit.port.onmidimessage);
  await setup.locator('.ww-midi-continue').click();
  await page.evaluate(async()=>{
    const {DawMix}=await import('/simulator/ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.w=this.w;return refresh.apply(this,args);};
  });
  const daw=page.locator('.ww-daw'),button=name=>daw.getByRole('button',{name,exact:true});
  const midi=async data=>page.evaluate(data=>audit.port.onmidimessage({data,timeStamp:performance.now()}),data);
  async function record(pitches,countIn){
    await daw.getByLabel('DAW count-in bars',{exact:true}).selectOption(String(countIn));
    await button('Record DAW').click();
    await page.waitForFunction(()=>audit.w.recorder.state==='recording',null,{timeout:13000});
    for(const pitch of pitches)await midi([144,pitch,95]);
    await page.waitForTimeout(290);
    for(const pitch of pitches)await midi([128,pitch,0]);
    await page.waitForFunction(()=>!audit.w.recorder.busy);
  }

  await button('Add MIDI track').click();
  await page.evaluate(async()=>{
    const w=audit.w,{uuid,makeTrack}=await import('/simulator/daw-project.js');
    const piano=w.selectedTrack(),bass=makeTrack('midi','Bass'),drums=makeTrack('midi','DRUM-X');
    const sound=await w.player.tone(64);
    bass.instrument={type:sound.patch[0]===4?'super':'analog',patch:sound.patch};
    const clips=[{id:uuid(),name:'Beat',type:'midi',trackId:drums.id,position:{unit:'ticks',value:0},
      length:3840,loopLength:3840,loop:false,notes:[0,960,1920,2880].map((start,i)=>({id:uuid(),pitch:i%2?38:36,velocity:100,start,duration:180}))}];
    w.controller.command('batch',{commands:[
      {type:'project.update',payload:{name:'Piano, bass and drums',length:3840,transport:{loop:true,start:0,end:3840}}},
      {type:'track.update',payload:{id:piano.id,changes:{name:'Piano'}}},
      {type:'track.create',payload:bass},{type:'track.create',payload:drums},{type:'clip.add',payload:clips[0]}
    ]});
    audit.ids={piano:piano.id,bass:bass.id,drums:drums.id};
  });
  await button('Select DRUM-X').click();
  await button('Show Track inspector').click();
  await daw.getByLabel('Selected instrument preset',{exact:true}).selectOption('drum:0');
  await page.waitForFunction(()=>audit.w.selectedTrack()?.instrument?.type==='drumx');
  await button('Select Piano').click();
  await button('Enable DAW MIDI input').click();
  await page.waitForFunction(()=>audit.w.monitor.ready);
  await midi([144,60,95]);
  await page.waitForFunction(()=>audit.w.frame.polyphony.slots.some(v=>v.gate&&v.note===60&&v.monitorChannel===0));
  assert.equal(await page.evaluate(()=>audit.w.snapshot.tracks.some(t=>t.arm)),false);
  await midi([128,60,0]);

  await button('Arm Piano').click();
  await record([60,64,67],1);
  await button('Select Bass').click();
  await button('Arm Bass').click();
  await record([36,43],0);
  assert.deepEqual(await page.evaluate(()=>audit.w.snapshot.clips.find(c=>c.trackId===audit.ids.piano).notes.map(n=>n.pitch)),[60,64,67]);
  assert.deepEqual(await page.evaluate(()=>audit.w.snapshot.clips.find(c=>c.trackId===audit.ids.bass).notes.map(n=>n.pitch)),[36,43]);

  await page.evaluate(async()=>{
    const w=audit.w,{effect}=await import('/simulator/daw-fx-catalog.js');
    const fx=effect('eq');fx.parameters.high=-2;
    w.controller.command('batch',{commands:[
      {type:'track.update',payload:{id:audit.ids.bass,changes:{volume:.7,pan:-.25,fx:[fx]}}},
      {type:'master.update',payload:{fx:[effect('limiter')]}}
    ]});
    audit.root=await navigator.storage.getDirectory();
    audit.file=await audit.root.getFileHandle('song.wsproj',{create:true});
  });
  await button('Disable DAW MIDI input').click();
  await clickDawFile(daw,'Save DAW project');
  await page.waitForFunction(()=>!audit.w.controller.dirty);
  const saved=await page.evaluate(()=>JSON.stringify(audit.w.snapshot));
  await clickDawFile(daw,'Open DAW project');
  await page.waitForFunction(()=>!audit.w.busy);
  assert.equal(await page.evaluate(()=>JSON.stringify(audit.w.snapshot)),saved);

  const report=await page.evaluate(async()=>{
    const w=audit.w,exporter=w.audioExport.exporter;
    async function exportFile(name,scope,trackId){
      audit.file=await audit.root.getFileHandle(name,{create:true});
      return exporter.choose({scope,format:'wav',trackId});
    }
    await w.player.stop(true);
    const song=await exportFile('song.wav','mix');
    const {wavHeader}=await import('/simulator/studio-format.js');
    const {sourceChecksum}=await import('/simulator/daw-format.js');
    const pcm=new Int16Array(44100*2).fill(2048);
    const source=new File([wavHeader(44100),pcm],'guide.wav',{type:'audio/wav'}),checksum=await sourceChecksum(source);
    const guide=await w.importer.import(source,{trackId:null,atBeat:0});
    w.controller.command('clip.update',{id:guide.id,changes:{offset:11025,frames:22050,fadeIn:1024,fadeOut:1024}});
    const range=await exportFile('range.wav','range');
    const track=await exportFile('guide-isolated.wav','track',guide.trackId);
    const mix=await exportFile('with-guide.wav','mix');
    return {song,range,track,mix,sourceIntact:await sourceChecksum(w.controller.assets.get(guide.assetId))===checksum,
      drumsRestored:w.snapshot.tracks.find(t=>t.id===audit.ids.drums).instrument.type==='drumx'};
  });
  for(const f of [report.song,report.range,report.track,report.mix])assert(f.frames===88200&&f.peaks[0]>.01);
  assert(report.sourceIntact&&report.drumsRestored);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(`${root}/song-journey.json`,JSON.stringify({result:'PASS',...report,physicalValidation:false},null,2));
  console.log(JSON.stringify({result:'PASS',...report}));
}finally{await browser.close();}
