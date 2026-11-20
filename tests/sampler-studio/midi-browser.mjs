// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {pcmWav} from './fixtures.mjs';

const evidence = process.env.SAMPLER_VALIDATION_ROOT || '.local/validation/sampler-studio-3';
const url = process.env.SAMPLER_BROWSER_URL || 'http://localhost:8737/simulator/';
const notes = Array.from({length:16}, (_, index) => 36 + index * 2);
const waveform = pcmWav(Int16Array.from({length:44100}, (_, frame) => Math.sin(frame * 440 * Math.PI / 44100) * 4200), {channels:1});
const source = Buffer.from(waveform).toString('base64');

function pcmPeak(wav) {
  assert.equal(wav.toString('ascii',0,4),'RIFF');
  assert.equal(wav.readUInt16LE(22),2);
  assert.equal(wav.readUInt32LE(24),44100);
  assert.equal(wav.readUInt16LE(34),16);
  assert.equal(wav.toString('ascii',36,40),'data');
  assert.equal(wav.readUInt32LE(40),wav.length-44);
  assert(wav.length>44);
  let peak=0;
  for(let offset=44;offset<wav.length;offset+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(offset)));
  return peak;
}

const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1560,height:1100}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.audit = {errors:[]};
    audit.source = {id:'sampler-performance-midi',name:'Sampler performance MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess = async () => ({inputs:new Map([[audit.source.id,audit.source]])});
    const Original=AudioWorkletNode;
    window.AudioWorkletNode=class extends Original {
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        this.port.addEventListener('message',({data})=>{
          if(data.t==='frame')audit.frame=data;
          if(data.t==='error')audit.errors.push(data.message);
          if(data.t==='daw-reply'&&!data.ok)audit.errors.push(data.error);
        });
      }
    };
  });
  await page.goto(new URL('?workspace=daw', url).href);
  await startSynth(page,{connect:true});
  await page.evaluate(async () => {
    const {DawMix}=await import('./ui-daw-mix.js'),derived=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.w=this.w;return derived.apply(this,args);};
  });
  const daw=page.locator('.ww-daw'),button=name=>daw.getByRole('button',{name,exact:true});
  const midi=data=>page.evaluate(data=>audit.source.onmidimessage({data,timeStamp:performance.now()}),data);
  await page.waitForFunction(()=>typeof audit.source.onmidimessage==='function');
  await button('Add MIDI track').click();
  await page.waitForFunction(()=>audit.w?.selectedTrack()?.type==='midi');
  await page.evaluate(async ({source,notes}) => {
    const {initializeLibrary,importOriginal,publish}=await import('./sampler-library.js');
    const {createKit}=await import('./sampler-kit.js');
    const {prepareSampler,setLiveSampler}=await import('./sampler.js');
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('Kit fixture',{create:true});
    await initializeLibrary(root,{id:'performance',name:'Performance kit'});
    const bytes=Uint8Array.from(atob(source),c=>c.charCodeAt(0));
    const sample=await importOriginal(root,bytes,'Samples/Originals/kit.wav',{id:'tone'});
    const create=noteList=>createKit({id:'pressure-kit',name:'Pressure kit',samples:[sample],
      pads:noteList.map((note,index)=>({index:index+1,note,mode:'gate',gainDb:-12,
        modulation:[{source:'channelPressure',destination:'gainDb',depth:12},
          {source:'polyPressure',destination:'gainDb',depth:6},{source:{cc:74},destination:'gainDb',depth:-18}],
        recordings:[{sample:sample.id,loop:{start:0,end:sample.frames}}]}))});
    const path='Kits/Pressure', first=await publish(root,create(notes),{path,expectedRevision:0});
    const second=await publish(root,create(notes.map(note=>note+1)),{path,expectedRevision:1});
    const w=audit.w;
    audit.first=await prepareSampler(w.player,root,first);
    audit.second=await prepareSampler(w.player,root,second);
    audit.track=w.selected;
    w.controller.command('track.update',{id:audit.track,changes:{instrument:audit.first,arm:true,monitor:'in'}});
    await setLiveSampler(w.player,audit.first);
  },{source,notes});

  await page.locator('[data-workspace="perf"]').first().click();
  for(const [index,note] of notes.entries()){
    const pad=page.locator(`#pads [data-pad="${index}"]`);
    assert.match(await pad.getAttribute('aria-label'),new RegExp(`MIDI note ${note}$`));
    await pad.focus();
    await page.keyboard.down('Enter');
    await page.waitForFunction(note=>audit.frame.polyphony.slots.some(voice=>voice.gate&&voice.note===note),note);
    await page.keyboard.up('Enter');
    await page.waitForFunction(note=>!audit.frame.polyphony.slots.some(voice=>voice.gate&&voice.note===note),note);
  }

  const firstPad=page.locator('#pads [data-pad="0"]');
  await firstPad.focus();
  await page.keyboard.down('Enter');
  await midi([144,notes[0],100]);
  await page.waitForFunction(note=>audit.frame.polyphony.slots.filter(v=>v.gate&&v.note===note).length===2,notes[0]);
  await page.evaluate(async()=>{const {setLiveSampler}=await import('./sampler.js');await setLiveSampler(audit.w.player,audit.second);});
  await page.keyboard.up('Enter');
  await page.waitForFunction(note=>audit.frame.polyphony.slots.filter(v=>v.gate&&v.note===note).length===1,notes[0]);
  await midi([128,notes[0],0]);
  await page.waitForFunction(()=>audit.frame.polyphony.slots.every(voice=>!voice.active));
  await page.evaluate(async()=>{const {setLiveSampler}=await import('./sampler.js');await setLiveSampler(audit.w.player,null);});
  assert.match(await firstPad.getAttribute('aria-label'),/^Pad 1:/);

  await page.locator('[data-workspace="daw"]').first().click();
  await page.evaluate(async()=>{
    const w=audit.w;
    Object.assign(w.recorder.settings,{countIn:0,click:false,replaceSelected:false});
    await w.player.graph();
    audit.analyser=w.player.context.createAnalyser();
    w.player.bus.connect(audit.analyser);
    audit.peak=()=>{
      const data=new Float32Array(audit.analyser.fftSize);
      audit.analyser.getFloatTimeDomainData(data);
      return data.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
    };
  });
  await button('Record DAW').click();
  await page.waitForFunction(()=>audit.w.recorder.state==='recording');
  await midi([144,notes[0],100]);
  await page.waitForFunction(()=>audit.peak()>.004);
  const base=await page.evaluate(()=>audit.peak());
  await midi([212,127]);
  await page.waitForTimeout(70);
  const otherChannel=await page.evaluate(()=>audit.peak());
  assert(Math.abs(otherChannel/base-1)<.08, `Pressure reached the wrong channel ${otherChannel/base}`);
  await midi([208,127]);
  try{await page.waitForFunction(base=>audit.peak()>base*3,base,{timeout:5000});}
  catch(error){
    const state=await page.evaluate(()=>({peak:audit.peak(),errors:audit.errors,status:audit.w.status.textContent,
      controls:audit.w.monitor.router.currentSamplerControls(),target:audit.w.monitor.target()}));
    throw Error(`Channel pressure produced ${JSON.stringify({base,otherChannel,...state})}`,{cause:error});
  }
  const pressure=await page.evaluate(()=>audit.peak());
  await midi([160,notes[0],127]);
  await page.waitForFunction(pressure=>audit.peak()>pressure*1.5,pressure);
  const polyPressure=await page.evaluate(()=>audit.peak());
  await midi([176,74,127]);
  await page.waitForFunction(polyPressure=>audit.peak()<polyPressure*.2,polyPressure);
  const cc=await page.evaluate(()=>audit.peak());
  await midi([176,64,127]);
  await midi([128,notes[0],0]);
  await page.waitForTimeout(80);
  assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(voice=>voice.gate&&voice.monitorChannel===0)));
  await midi([176,64,0]);
  await page.waitForFunction(()=>audit.frame.polyphony.slots.every(voice=>!voice.active));
  await button('Stop DAW').click();
  await page.waitForFunction(()=>!audit.w.recorder.busy);
  const take=await page.evaluate(()=>({clip:audit.w.snapshot.clips.find(clip=>clip.trackId===audit.track),status:audit.w.status.textContent}));
  assert(take.clip,take.status);
  assert.deepEqual(take.clip.notes.map(n=>[n.pitch,n.channel]),[[notes[0],0]]);
  const controls=take.clip.midiEvents.map(({type,channel,note,controller,value})=>[type,channel,note,controller,value]);
  assert(controls.some(([type,channel,,,value])=>type==='channelPressure'&&channel===4&&value===127));
  assert(controls.some(([type,channel,note,,value])=>type==='polyPressure'&&channel===0&&note===notes[0]&&value===127));
  assert.deepEqual(take.clip.midiEvents.filter(event=>event.controller===64).map(event=>event.value),[127,0]);

  const rendered=await page.evaluate(async()=>{
    const w=audit.w,trackId=audit.track;
    await w.monitor.disable();
    const directory=await (await navigator.storage.getDirectory()).getDirectoryHandle('kit-export',{create:true});
    window.showSaveFilePicker=async({suggestedName})=>directory.getFileHandle(suggestedName,{create:true});
    async function render(scope){
      const {name}=await w.audioExport.exporter.choose({scope,trackId,format:'wav',tail:0});
      const file=await (await directory.getFileHandle(name)).getFile();
      return new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result.split(',')[1]);
        reader.onerror=()=>reject(reader.error);
        reader.readAsDataURL(file);
      });
    }
    const stem=await render('track');
    const muteBefore=w.snapshot.tracks.find(track=>track.id===trackId).mute;
    let mutedMaster;
    try{
      w.controller.command('track.update',{id:trackId,changes:{mute:true}});
      mutedMaster=await render('mix');
    }finally{
      w.controller.command('track.update',{id:trackId,changes:{mute:muteBefore}});
    }
    return {stem,mutedMaster,muteRestored:w.snapshot.tracks.find(track=>track.id===trackId).mute===muteBefore};
  });
  const stem=Buffer.from(rendered.stem,'base64');
  const mutedMaster=Buffer.from(rendered.mutedMaster,'base64');
  const stemPeak=pcmPeak(stem),mutedMasterPeak=pcmPeak(mutedMaster);
  assert(stemPeak>base*32768*2,`Kit stem peak ${stemPeak} did not reproduce recorded pressure`);
  assert.equal(mutedMasterPeak,0);
  assert(rendered.muteRestored);
  assert.deepEqual([...errors,...await page.evaluate(()=>audit.errors)],[]);
  const report={result:'PASS',chrome:await browser.version(),virtualPads:notes,ownerSurvivedRebind:true,
    peaks:{base,otherChannel,pressure,polyPressure,cc},controls,export:{stemPeak,mutedMasterPeak,muteRestored:true},
    physicalHardware:false,directoryHandle:'OPFS'};
  fs.mkdirSync(evidence,{recursive:true});
  fs.writeFileSync(`${evidence}/kit-take-stem.wav`,stem);
  fs.writeFileSync(`${evidence}/kit-take-muted-master.wav`,mutedMaster);
  fs.writeFileSync(`${evidence}/midi-browser.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await browser.close();}
