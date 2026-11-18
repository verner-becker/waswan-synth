// SPDX-License-Identifier: GPL-3.0-only
import {clickDawFile} from './daw-browser-controls.mjs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/daw-mvp-wave-7';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  await page.addInitScript(()=>{
    window.audit={contexts:0};
    const Context=AudioContext;
    window.AudioContext=class extends Context{constructor(...args){super(...args);audit.context=this;audit.contexts++;}};
    const Node=AudioWorkletNode;
    window.AudioWorkletNode=class extends Node{
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        audit.node=this;
        this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});
      }
    };
    showSaveFilePicker=async()=>audit.file;
    showOpenFilePicker=async()=>[audit.file];
    showDirectoryPicker=async()=>audit.destination;
  });
  await page.goto('http://localhost:8737/simulator/?workspace=daw');
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.waitForFunction(()=>audit.frame?.ms>5000);
  await page.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
  await page.evaluate(async()=>{
    const {DawMix}=await import('/simulator/ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.w=this.w;return refresh.apply(this,args);};
  });
  await page.getByRole('button',{name:'Add audio track',exact:true}).click();
  await page.evaluate(async()=>{
    const [{makeTrack,emptyProject,uuid},{wavHeader},{effect}]=await Promise.all(
      ['daw-project','studio-format','daw-fx-catalog'].map(n=>import('/simulator/'+n+'.js')));
    const p=emptyProject(),a=makeTrack('audio','Voice / A'),b=makeTrack('audio','Muted pulse');
    const delay=effect('delay');Object.assign(delay.parameters,{time:.01,mix:1,feedback:.5});
    p.name='Export test';p.length=960;p.transport={loop:true,start:288,end:576};
    p.master.volume=.5;a.volume=.5;b.mute=true;b.fx=[delay];
    p.tracks.push(a,b);
    const frames=8820,pcm=new Int16Array(frames*2);
    for(let i=0;i<frames;i++){pcm[i*2]=8192;pcm[i*2+1]=4096;}
    const pulse=new Int16Array(8);pulse[0]=pulse[1]=10000;
    const assets=new Map();
    for(const [track,samples,start] of [[a,pcm,.1],[b,pulse,.49]]){
      const id=uuid(),frames=samples.length/2;
      const blob=new Blob([wavHeader(frames),samples],{type:'audio/wav'});
      assets.set(id,blob);
      p.assets.push({id,name:track.name,sampleRate:44100,channels:2,frames,bytes:blob.size});
      p.clips.push({id:uuid(),trackId:track.id,name:track.name,type:'audio',position:{unit:'seconds',value:start},assetId:id,offset:0,frames,gain:1,fadeIn:0,fadeOut:0});
    }
    p.automation.push({id:uuid(),trackId:a.id,target:'volume',curve:'step',enabled:true,points:[{tick:0,value:.5},{tick:384,value:1}]});
    await audit.w.adopt({project:p,assets,dispose:async()=>{},warnings:[]});
    audit.root=await navigator.storage.getDirectory();
    audit.file=await audit.root.getFileHandle('mix.wav',{create:true});
    audit.destination=await audit.root.getDirectoryHandle('stems-test',{create:true});
    audit.w.bridge.getAudio().gain.gain.value=0;
    audit.w.click.checked=true;audit.w.click.onchange();
    audit.patchBefore=await audit.w.player.requests().request('daw-state-request');
    audit.revision=audit.w.controller.revision;
    audit.cursor=audit.w.cursor;
    audit.wav=async handle=>{
      const buffer=await(await handle.getFile()).arrayBuffer(),view=new DataView(buffer);
      if(view.getUint32(0)!==0x52494646||view.getUint32(24,true)!==44100||view.getUint32(40,true)!==buffer.byteLength-44)throw Error('Bad WAV header');
      return new Int16Array(buffer,44);
    };
  });

  const daw=page.locator('.ww-daw'),dialog=page.getByRole('dialog',{name:'Export DAW audio'});
  await clickDawFile(daw,'Export audio…');
  await dialog.getByLabel('Tail',{exact:false}).selectOption('0');
  await dialog.getByRole('button',{name:'Choose destination and export…'}).click();
  await dialog.waitFor({state:'hidden',timeout:13000}).catch(async error=>{
    throw Error(await dialog.textContent()+': '+error.message);
  });
  const mix=await page.evaluate(async()=>{
    const pcm=await audit.wav(audit.file);
    return {frames:pcm.length/2,before:pcm.slice(0,8820).every(x=>x===0),left:pcm[8820],right:pcm[8821],
      automated:pcm[17640],after:pcm.slice(26460).every(x=>x===0)};
  });
  assert.deepEqual(mix,{frames:22050,before:true,left:2048,right:1024,automated:4096,after:true});

  const other=await page.evaluate(async()=>{
    const {w}=audit,exporter=w.audioExport.exporter;
    async function single(name,options){
      audit.file=await audit.root.getFileHandle(name,{create:true});
      const result=await exporter.choose(options);
      return {result,pcm:options.format==='mp3'?null:await audit.wav(audit.file)};
    }
    const {uuid,makeTrack}=await import('/simulator/daw-project.js');
    const future=makeTrack('midi','Unassigned later track');
    w.controller.command('batch',{commands:[
      {type:'project.update',payload:{length:2600000}},
      {type:'track.create',payload:future},
      {type:'clip.add',payload:{id:uuid(),trackId:future.id,type:'midi',name:'Later',position:{unit:'ticks',value:2500000},length:960,loopLength:960,loop:false,notes:[{id:uuid(),pitch:60,velocity:100,start:0,duration:960}]}}
    ]});
    const range=await single('range.wav',{scope:'range',format:'wav'});
    w.controller.command('undo');
    audit.revision=w.controller.revision;

    const clip=await single('clip.wav',{scope:'selection',format:'wav',clipIds:new Set([w.snapshot.clips[0].id])});
    const track=await single('track.wav',{scope:'track',format:'wav',trackId:w.snapshot.tracks[0].id});
    const stems=await exporter.choose({scope:'stems',format:'wav',tail:2});
    const dir=await audit.destination.getDirectoryHandle(stems.name),files=[];
    for await(const [name,handle] of dir){const pcm=await audit.wav(handle);let echo=0,echoAt=-1;
      for(let i=22051;i<Math.min(24000,pcm.length/2);i++)if(Math.abs(pcm[i*2])>echo){echo=Math.abs(pcm[i*2]);echoAt=i;}
      files.push({name,frames:pcm.length/2,first:pcm[8820],echo,echoAt});}
    await single('range.mp3',{scope:'range',format:'mp3'});
    const mp3=await audit.context.decodeAudioData(await(await audit.file.getFile()).arrayBuffer());
    const patch=await w.player.requests().request('daw-state-request');
    const temporary=await audit.root.getDirectoryHandle('waswan-daw-exports-v1'),orphans=[];
    const {cleanAudioExports}=await import('/simulator/daw-audio-export.js');
    const stale=uuid(),active=uuid();
    await temporary.getDirectoryHandle(stale,{create:true});
    await temporary.getDirectoryHandle(active,{create:true});
    await navigator.locks.request('waswan-daw-export:'+active,async()=>{
      await cleanAudioExports(temporary);
      await temporary.getDirectoryHandle(active);
      try{await temporary.getDirectoryHandle(stale);throw Error('Orphan not removed');}
      catch(error){if(error.name!=='NotFoundError')throw error;}
    });
    await cleanAudioExports(temporary);
    for await(const name of temporary.keys())orphans.push(name);
    return {range:{frames:range.pcm.length/2,first:range.pcm[0],last:range.pcm.at(-2)},
      clip:{frames:clip.pcm.length/2,first:clip.pcm[0]},track:{frames:track.pcm.length/2,first:track.pcm[8820]},
      files:files.sort((a,b)=>a.name.localeCompare(b.name)),mp3Frames:mp3.length,mp3Audible:mp3.getChannelData(0).some(v=>v>.06),
      oneContext:audit.contexts===1,unchanged:JSON.stringify(patch)===JSON.stringify(audit.patchBefore)&&w.cursor===audit.cursor&&w.controller.revision===audit.revision,orphans};
  });
  assert.deepEqual(other.range,{frames:6615,first:2048,last:4096});
  assert.deepEqual(other.clip,{frames:8820,first:2048});
  assert.deepEqual(other.track,{frames:22050,first:4096});
  assert.deepEqual(other.files.map(f=>f.name),['01 - Voice - A.wav','02 - Muted pulse.wav']);
  assert(other.files.every(f=>f.frames===110250));
  assert.equal(other.files[0].first,4096);
  assert(other.files[1].echo>4000,'Delay tail after the song boundary: '+JSON.stringify(other.files[1]));
  assert(other.mp3Frames>=6615&&other.mp3Frames<=6615+2304&&other.mp3Audible);
  assert(other.oneContext&&other.unchanged);
  assert.deepEqual(other.orphans,[]);

  const instrument=await page.evaluate(async()=>{
    const {w}=audit,exporter=w.audioExport.exporter;
    const {uuid,makeTrack}=await import('/simulator/daw-project.js');
    const t=makeTrack('midi','Synth export'),sound=await w.player.tone(68);
    t.instrument={type:sound.patch[0]===4?'super':'analog',patch:sound.patch};
    w.controller.command('batch',{commands:[
      {type:'track.create',payload:t},
      {type:'clip.add',payload:{id:uuid(),trackId:t.id,type:'midi',name:'Note',position:{unit:'ticks',value:0},length:960,loopLength:960,loop:false,notes:[{id:uuid(),pitch:60,velocity:100,start:0,duration:720}]}}
    ]});
    audit.file=await audit.root.getFileHandle('instrument.wav',{create:true});
    const previous=await w.player.requests().request('daw-state-request');
    const result=await exporter.choose({scope:'track',trackId:t.id,format:'wav',tail:2},(stage)=>{
      if(stage.startsWith('Rendering'))audit.node.port.postMessage({t:'midi',st:144,d1:72,d2:100});
    });
    const pcm=await audit.wav(audit.file);
    const after=await w.player.requests().request('daw-state-request');
    audit.node.port.postMessage({t:'midi',st:144,d1:74,d2:100});
    await new Promise(resolve=>setTimeout(resolve,100));
    let refused=false;
    try{await exporter.choose({scope:'mix',format:'wav'});}
    catch(error){refused=/fall silent/.test(error.message);}
    audit.node.port.postMessage({t:'midi',st:128,d1:74,d2:0});
    await new Promise(resolve=>setTimeout(resolve,800));
    return {peak:result.peaks[0],frames:pcm.length/2,audible:pcm.some(v=>Math.abs(v)>512),restored:JSON.stringify(previous)===JSON.stringify(after),refused};
  });
  assert(instrument.peak>.02&&instrument.audible&&instrument.restored&&instrument.refused);
  assert.equal(instrument.frames,110250);

  const cancellation=await page.evaluate(async()=>{
    const {w}=audit,exporter=w.audioExport.exporter;
    const track=w.snapshot.tracks[0],revision=w.controller.revision;
    audit.file=await audit.root.getFileHandle('cancel.wav',{create:true});
    const writer=await audit.file.createWritable();await writer.write('original');await writer.close();
    let cancelled=false;
    try{await exporter.choose({scope:'track',trackId:track.id,format:'wav',tail:8},stage=>{
      if(stage==='Rendering audio')exporter.cancel();
    });}catch(error){cancelled=error.name==='AbortError';}
    const intact=await(await audit.file.getFile()).text()==='original';
    const root=await audit.root.getDirectoryHandle('waswan-daw-exports-v1'),orphans=[];
    for await(const name of root.keys())orphans.push(name);
    return {cancelled,intact,orphans,unlocked:!exporter.busy&&!w.player.exporting,
      unchanged:w.controller.revision===revision,contexts:audit.contexts};
  });
  assert.deepEqual(cancellation,{cancelled:true,intact:true,orphans:[],unlocked:true,unchanged:true,contexts:1});
  const presets=await page.evaluate(async()=>{
    const {w}=audit,track=w.snapshot.tracks[1],revision=w.controller.revision;
    const {saveTrackPreset,loadTrackPreset}=await import('/simulator/daw-track-preset.js');
    audit.file=await audit.root.getFileHandle('track.wspreset',{create:true});
    await saveTrackPreset(track,'track');
    const file=JSON.parse(await(await audit.file.getFile()).text());
    const target=w.snapshot.tracks[0],clips=JSON.stringify(w.snapshot.clips);
    const asset=w.controller.assets.get(w.snapshot.clips[0].assetId);
    await loadTrackPreset(w.controller,target);
    const changed=w.snapshot.tracks[0],inc=w.controller.revision===revision+1;
    w.controller.command('undo');
    return file.values.volume===track.volume&&changed.fx[0].type==='delay'&&changed.fx[0].id!==track.fx[0].id&&
      changed.mute===target.mute&&inc&&w.snapshot.tracks[0].name===target.name&&JSON.stringify(w.snapshot.clips)===clips&&
      w.controller.assets.get(w.snapshot.clips[0].assetId)===asset;
  });
  assert(presets);
  assert.deepEqual(errors,[]);
  const result={result:'PASS',mix,other,instrument,cancellation,presets,physicalValidation:false};
  fs.writeFileSync(`${root}/browser-audio-export.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await browser.close();}
