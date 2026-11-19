// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {notes,hz,amplitude} from './mellotron-a/fixture.mjs';

export async function checkCapture(frame,browser,directory,errors,tapes=false){
  await frame.evaluate(async()=>{
    const {DawMix}=await import('./ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.w=this.w;return refresh.apply(this,args);};
    // Only the export destination is a test double. The normal DAW capture,
    // worker, encoder and file writer produce the blob copied to disk below.
    window.showSaveFilePicker=async()=>({name:'probe.wav',async createWritable(){
      const chunks=[];
      return new WritableStream({write:chunk=>chunks.push(chunk),close:()=>{audit.wav=new Blob(chunks);}});
    }});
  });
  await frame.getByRole('button',{name:'Add audio track',exact:true}).click();
  await frame.waitForFunction(()=>audit.w.frame?.ms>5000);
  await frame.evaluate(async()=>{
    const w=audit.w;
    const track=w.selected;
    w.controller.command('batch',{commands:[
      {type:'project.update',payload:{length:3840,transport:{loop:true,start:0,end:3840}}},
      {type:'track.update',payload:{id:track,changes:{arm:true}}}
    ]});
    const {node,gain}=w.bridge.getAudio();gain.gain.value=0;
    audit.dsp=[];
    node.port.addEventListener('message',({data:m})=>{
      if(m.t==='dsp-window')audit.dsp.push({voices:m.voices,stats:m.stats,measurement:m.measurement});
    });
    node.port.postMessage({t:'dsp-control',action:'start',session:'mellotron-probe'});
    node.port.postMessage({t:'voice-mode',part:0,mode:0});
    Object.assign(w.recorder.settings,{countIn:0,deviceId:'waswan:internal-synth',click:false});
    audit.note=(pitch,on)=>node.port.postMessage({t:'midi',st:on?144:128,d1:pitch,d2:on?100:0});
  });
  await frame.getByRole('button',{name:'Record DAW',exact:true}).click();
  await frame.waitForFunction(()=>audit.w.recorder.state==='recording');
  await frame.evaluate(ns=>ns.forEach(n=>audit.note(n,true)),notes);
  await frame.waitForFunction(()=>audit.w.frame.polyphony.slots.filter(v=>v.gate).length===3);
  if(tapes){
    await frame.waitForTimeout(230);
    await frame.evaluate(ns=>{
      const port=audit.w.bridge.getAudio().node.port;
      port.postMessage({t:'midi',st:176,d1:64,d2:127});
      ns.forEach(n=>audit.note(n,false));
      port.postMessage({t:'midi',st:224,d1:0,d2:80});
    },notes);
    await frame.waitForTimeout(100);
    await frame.evaluate(ns=>{
      const port=audit.w.bridge.getAudio().node.port;
      port.postMessage({t:'midi',st:224,d1:0,d2:64});
      port.postMessage({t:'midi',st:176,d1:64,d2:0});
      audit.note(ns[0],true);
    },notes);
    await frame.waitForTimeout(100);
  }else await frame.waitForTimeout(450);
  await frame.evaluate(ns=>ns.forEach(n=>audit.note(n,false)),notes);
  await frame.waitForFunction(()=>!audit.w.recorder.busy);
  await frame.evaluate(()=>{
    const w=audit.w,clip=w.snapshot.clips.find(c=>c.type==='audio');
    if(!clip)throw Error(w.status.textContent);
    audit.wav=w.controller.assets.get(clip.assetId);
  });
  async function save(name){
    const b64=await frame.evaluate(async()=>{
      const reader=new FileReader();const loaded=new Promise((resolve,reject)=>{
        reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(reader.error);
      });reader.readAsDataURL(audit.wav);return loaded;
    });
    const bytes=Buffer.from(b64,'base64');
    assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt32LE(24),44100);
    assert.equal(bytes.readUInt16LE(22),2);assert.equal(bytes.readUInt32LE(40),bytes.length-44);
    fs.writeFileSync(directory+'/'+name+'.wav',bytes);
    return new Int16Array(bytes.buffer,bytes.byteOffset+44,(bytes.length-44)/2);
  }
  function measure(pcm) {
    const frames=pcm.length/2, window=8192;
    let best=0, levels=[], background=0;
    for(let at=0;at+window<=frames;at+=4096) {
      const amplitudes=notes.map(n=>amplitude(pcm,at,window,hz(n))),weakest=Math.min(...amplitudes);
      if(weakest>best){
        best=weakest;levels=amplitudes;
        background=Math.max(...[180,250,300,375,420].map(f=>amplitude(pcm,at,window,f)));
      }
    }
    return {frames,levels,background};
  }
  const capture=measure(await save('internal'));
  function assertChord(result) {
    assert.equal(result.levels.length,3);
    assert(Math.min(...result.levels)>Math.max(10,8*result.background), JSON.stringify(result));
  }
  assertChord(capture);
  await frame.evaluate(async ({ns,tapes})=>{
    const w=audit.w,{emptyProject,makeTrack,uuid}=await import('./daw-project.js');
    const p=emptyProject(),m=makeTrack('midi','Sample chord'),quiet=makeTrack('audio','Silence');
    const {patch}=await w.player.tone(68);
    patch[0]=1;patch[24]=0;patch[26]=127;patch[27]=0;patch[38]=0;patch[39]=1;patch[42]=0;patch[43]=0;patch[47]=0;
    m.instrument={type:'analog',patch};m.volume=1;p.master.volume=1;
    p.length=2880;
    if(tapes){
      const other=makeTrack('midi','Analog without clips');other.instrument={type:'analog',patch:[...patch]};
      p.tracks.push(m,other);
    }
    if(!tapes)p.tracks.push(m);
    p.tracks.push(quiet);
    p.clips.push({id:uuid(),trackId:m.id,type:'midi',name:'Sample chord',position:{unit:'ticks',value:0},
      length:p.length,loopLength:p.length,loop:false,notes:ns.map(pitch=>({id:uuid(),pitch,velocity:100,start:480,duration:960}))});
    await w.adopt({project:p,assets:new Map(),dispose:async()=>{},warnings:[]});
    if(tapes){
      await w.selectInstrument(m.id,'mellotron');
      w.controller.command('track.move',{id:m.id,index:1});
      const {projectBlob,readProject}=await import('./daw-format.js');
      const saved=await projectBlob(w.controller.snapshot(),new Map());
      await w.adopt(await readProject(saved));
      if(w.controller.snapshot().tracks.find(t=>t.id===m.id).instrument.type!=='mellotron')throw Error('Tape assignment failed');
    }
    audit.track=m.id;audit.quiet=quiet.id;
  },{ns:notes,tapes});
  async function render(scope,id,name){
    await frame.evaluate(async({scope,id})=>{
      const options={scope,format:'wav',tail:0};if(id)options.trackId=audit[id];
      await audit.w.audioExport.exporter.choose(options);
    },{scope,id});
    return save(name);
  }
  const masterPcm=await render('mix',null,'master'), master=measure(masterPcm);
  const stemPcm=await render('track','track','sample-track'), stem=measure(stemPcm);
  assertChord(master);assertChord(stem);
  for(let i=0;i<3;i++){
    assert(stem.levels[i]>10);
    const ratio=master.levels[i]/stem.levels[i];
    assert(ratio>.93&&ratio<1.07,'Master/track level '+ratio);
  }
  for(const pcm of [masterPcm,stemPcm]){
    assert(pcm.slice(0,4410).every(s=>s===0));
    assert(pcm.slice(-4410).every(s=>s===0));
  }
  assert((await render('track','quiet','silent-track')).every(s=>s===0));
  if(tapes){
    await frame.evaluate(()=>audit.w.controller.command('track.update',{id:audit.quiet,changes:{solo:true}}));
    assert((await render('mix',null,'solo-quiet')).every(s=>s===0));
    await frame.evaluate(()=>audit.w.controller.command('track.update',{id:audit.quiet,changes:{solo:false}}));
  }
  await frame.evaluate(()=>audit.w.controller.command('track.update',{id:audit.track,changes:{mute:true}}));
  assert((await render('mix',null,'muted-master')).every(s=>s===0));
  assert.equal(await frame.evaluate(()=>audit.contexts),1);
  assert.deepEqual(errors,[]);
  const report={chrome:browser.version(),capture,master,stem,expectedHz:notes.map(hz),
    silentTrack:true,mutedMasterSilent:true,oneContext:true,physicalValidation:false,
    dspWindows:await frame.evaluate(()=>audit.dsp)};
  fs.writeFileSync(directory+'/browser.json',JSON.stringify(report,null,2));
  console.log({...report,dspWindows:report.dspWindows.length});
}
