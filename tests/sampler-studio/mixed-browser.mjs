// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {clickDawFile} from '../daw-browser-controls.mjs';
import {pcmWav} from './fixtures.mjs';

const evidence=process.env.SAMPLER_VALIDATION_ROOT||'.local/validation/sampler-studio-5';
const url=process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/';
const exportedTape=process.env.SAMPLER_TAPE_FIXTURE_DIR||path.join(evidence,'exports','Fixture piano tape');
const rate=44100;
const frequency=[233,547];
const tone=JSON.parse(fs.readFileSync('banks/DX7 - Aquanode/28-SBass2.wstone','utf8'));
const wav=(channels,frames,level)=>Buffer.from(pcmWav(Int16Array.from({length:frames*channels},(_,sample)=>
  level*Math.sin(2*Math.PI*frequency[sample%channels]*Math.floor(sample/channels)/rate)),{channels})).toString('base64');
const tapes=fs.existsSync(exportedTape)?['48.wav','60.wav','72.wav'].map(name=>[name,fs.readFileSync(path.join(exportedTape,name)).toString('base64')]):
  [['60.wav',wav(1,rate/2,8500)]];
const tracks=['Analog','FM','Mellotron','Sampler'];
const pitches=[55,48,60,60];
const notes=[192,960,1728,2496];
const startFrames=notes.map(tick=>Math.round(tick*rate/1920));
function wavData(encoded,name){
  const bytes=Buffer.from(encoded,'base64');
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.readUInt16LE(22),2);
  assert.equal(bytes.readUInt32LE(24),rate);
  assert.equal(bytes.readUInt32LE(40),bytes.length-44);
  fs.writeFileSync(path.join(evidence,`${name}.wav`),bytes);
  return new Int16Array(bytes.buffer,bytes.byteOffset+44,(bytes.length-44)/2);
}
function magnitude(pcm,channel,start,hz){
  const width=4096;let re=0,im=0;
  for(let i=0;i<width;i++){
    const x=pcm[2*(start+i)+channel]*(1-Math.cos(2*Math.PI*i/width)),angle=2*Math.PI*hz*i/rate;
    re+=x*Math.cos(angle);im+=x*Math.sin(angle);
  }
  return Math.hypot(re,im)*2/width;
}
function peak(pcm,start,frames){let value=0;for(let i=start*2;i<(start+frames)*2;i++)value=Math.max(value,Math.abs(pcm[i]));return value;}
function activePcm(pcm){
  const first=pcm.findIndex(value=>value!==0),last=pcm.findLastIndex(value=>value!==0);
  assert(first>=0,'Sampler stem is silent');
  const onset=Math.floor(first/2);
  return {onset,pcm:pcm.subarray(onset*2,(Math.floor(last/2)+1)*2)};
}

fs.mkdirSync(evidence,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'waswan-mixed-browser-'));
const errors=[];
let context,page;
async function open(){
  context=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/google-chrome',headless:true,viewport:{width:1560,height:1100}});
  page=context.pages()[0];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.audit={contexts:0,hostNodes:0,picks:0};
    const Context=AudioContext;
    window.AudioContext=class extends Context {constructor(...args){super(...args);audit.contexts++;}};
    const Original=AudioWorkletNode;
    window.AudioWorkletNode=class extends Original {
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        audit.hostNodes++;
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
    audit.directory=async name=>(await navigator.storage.getDirectory()).getDirectoryHandle(name,{create:true});
    audit.write=async (directory,name,content)=>{
      const dest=await directory.getFileHandle(name,{create:true});
      const writer=await dest.createWritable();
      await writer.write(content);await writer.close();
      return dest;
    };
    audit.base64=blob=>new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
    });
    window.showOpenFilePicker=async()=>[await (await navigator.storage.getDirectory()).getFileHandle('Mixed.wsproj')];
    window.showDirectoryPicker=async ({id})=>{
      if(id==='waswan-samples'){audit.picks++;return audit.directory(audit.sampleRootName);}
      return audit.directory(audit.exportName);
    };
    window.showSaveFilePicker=async({suggestedName})=>(await audit.directory(audit.exportName)).getFileHandle(suggestedName,{create:true});
    audit.loadTape=async()=>{
      const {preparePair}=await import('./mellotron-library.js');
      const {tapeDefaults}=await import('./mellotron-settings.js');
      const banks=['Fixture piano tape','Fixture piano tape'];
      const {id,regions}=await preparePair(await audit.directory('Tapes'),banks);
      const tape={id,banks,settings:{...tapeDefaults(),attack:2,release:3}};
      const rpc=audit.w.player.requests();
      const token=await rpc.request('daw-tape-begin',{regions:regions.map(({bank,root,pcm})=>({bank,root,frames:pcm.length}))});
      let offset=0;
      for(const {pcm} of regions){
        for(let i=0;i<pcm.length;i+=32768){
          const chunk=pcm.slice(i,i+32768);
          const length=chunk.length;
          await rpc.request('daw-tape-chunk',{token,pcm:chunk,offset},[chunk.buffer]);
          offset+=length;
        }
      }
      await rpc.request('daw-tape-commit',{token,tape});
      await rpc.request('daw-tape-live',{enabled:false,settings:tape.settings});
      return audit.w.player.tapeInstrument(tape);
    };
  });
  await page.goto(new URL('?workspace=daw',url).href);
  await startSynth(page);
}

try{
  await open();
  let daw=page.locator('.ww-daw');
  const button=name=>daw.getByRole('button',{name,exact:true});
  await page.evaluate(async()=>{
    const {DawMix}=await import('./ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.w=this.w;return refresh.apply(this,args);};
  });
  await button('Add MIDI track').click();
  await page.waitForFunction(()=>audit.w?.selectedTrack());
  await page.evaluate(async ({tapes,source})=>{
    const bytes=text=>Uint8Array.from(atob(text),char=>char.charCodeAt(0));
    const root=await audit.directory('Tapes');
    const tapeFolder=await root.getDirectoryHandle('Fixture piano tape',{create:true});
    for(const [name,wav] of tapes)await audit.write(tapeFolder,name,bytes(wav));
    audit.sampleRootName='Original library';
    const sampleRoot=await audit.directory(audit.sampleRootName);
    const {initializeLibrary,importOriginal,publish}=await import('./sampler-library.js');
    const {mapSample,prepareSampler}=await import('./sampler.js');
    await initializeLibrary(sampleRoot,{id:'mixed-library',name:'Mixed project library'});
    const sample=await importOriginal(sampleRoot,bytes(source),'Samples/Originals/stereo.wav',{id:'stereo'});
    const reference=await publish(sampleRoot,mapSample(sample,60,{name:'Stereo source',mode:'oneShot'}),{path:'Instruments/Stereo',expectedRevision:0});
    audit.instrument=await prepareSampler(audit.w.player,sampleRoot,reference);
    const {load}=await import('./sampler-library.js');
    const first=await load(sampleRoot,reference);
    await publish(sampleRoot,{...first,gainDb:-30},{path:reference.path,expectedRevision:1});
  },{tapes,source:wav(2,Math.floor(.24*rate),7500)});

  async function chooseSamples(name){
    await page.evaluate(name=>audit.sampleRootName=name,name);
    await page.locator('[data-workspace="perf"]').first().click();
    await page.getByRole('button',{name:'Instrument setup',exact:true}).click();
    const folders=page.locator('.ww-library-folders');
    if(!await folders.evaluate(node=>node.open))await folders.locator('summary').click();
    const group=folders.getByRole('group',{name:/^Samples/});
    await group.getByRole('button',{name:'Choose folder…'}).click();
    await group.getByText(name,{exact:true}).waitFor();
    await page.locator('[data-workspace="daw"]').first().click();
  }
  await chooseSamples('Original library');
  const saved=await page.evaluate(async ({tracks,pitches,notes,tone})=>{
    const {emptyProject,makeTrack,uuid}=await import('./daw-project.js');
    const {projectBlob}=await import('./daw-format.js');
    const w=audit.w,project=emptyProject();
    project.name='Mixed';project.length=3360;project.transport={start:0,end:project.length,loop:false};
    const tape=await audit.loadTape();
    const analog=await w.player.tone(68);
    analog.patch[38]=0;analog.patch[39]=1;
    tone.patch[38]=0;tone.patch[39]=1;
    const instruments=[{type:'analog',patch:analog.patch},{type:'analog',patch:tone.patch},tape,audit.instrument];
    for(const [index,name] of tracks.entries()){
      const track=makeTrack('midi',name);track.instrument=instruments[index];track.volume=.7;
      project.tracks.push(track);
      project.clips.push({id:uuid(),type:'midi',trackId:track.id,name,position:{unit:'ticks',value:0},length:project.length,
        loopLength:project.length,loop:false,notes:[{id:uuid(),pitch:pitches[index],velocity:105,start:notes[index],duration:430}]});
    }
    await w.adopt({project,assets:new Map(),dispose:async()=>{},warnings:[]});
    await audit.write(await navigator.storage.getDirectory(),'Mixed.wsproj',await projectBlob(project,new Map()));
    return {ids:project.tracks.map(track=>track.id),instrument:audit.instrument};
  },{tracks,pitches,notes,tone});

  async function exportAudio(scope,name,trackId){
    return page.evaluate(async ({scope,name,trackId})=>{
      audit.exportName=name;
      const result=await audit.w.audioExport.exporter.choose({scope,trackId,format:'wav',tail:0});
      const destination=await audit.directory(name),data=[];
      const directory=scope==='stems'?await destination.getDirectoryHandle(result.name):destination;
      for await(const file of directory.values())if(file.kind==='file')data.push([file.name,await audit.base64(await file.getFile())]);
      return data.sort((a,b)=>a[0].localeCompare(b[0]));
    },{scope,name,trackId});
  }
  const before=await exportAudio('track','before',saved.ids[3]);
  const samplerBefore=wavData(before[0][1],'sampler-before-move');
  await page.evaluate(async()=>{
    const storage=await navigator.storage.getDirectory();
    const from=await storage.getDirectoryHandle('Original library'),to=await audit.directory('Relocated library');
    async function copyTree(source,destination){
      for await(const entry of source.values()){
        if(entry.kind==='directory')await copyTree(entry,await destination.getDirectoryHandle(entry.name,{create:true}));
        else await audit.write(destination,entry.name,await entry.getFile());
      }
    }
    await copyTree(from,to);
    const instruments=await to.getDirectoryHandle('Instruments'),old=await instruments.getDirectoryHandle('Stereo');
    await copyTree(old,await instruments.getDirectoryHandle('Relocated stereo',{create:true}));
    await instruments.removeEntry('Stereo',{recursive:true});
    await storage.removeEntry('Original library',{recursive:true});
  });
  const firstRuntime=await page.evaluate(()=>({contexts:audit.contexts,hostNodes:audit.hostNodes,picks:audit.picks}));
  assert.deepEqual(firstRuntime,{contexts:1,hostNodes:1,picks:1});
  await context.close();
  await open();
  daw=page.locator('.ww-daw');
  await chooseSamples('Relocated library');
  await page.evaluate(async()=>{
    const {DawWorkspace}=await import('./ui-daw.js'),adopt=DawWorkspace.prototype.adopt;
    DawWorkspace.prototype.adopt=function(...args){audit.w=this;return adopt.apply(this,args);};
  });
  await clickDawFile(daw,'Open DAW project');
  await page.waitForFunction(()=>audit.w?.snapshot.tracks.length===4);
  const loaded=await page.evaluate(async instrument=>{
    const tape=await audit.loadTape();
    const {verify}=await import('./sampler-library.js');
    const verified=await verify(await audit.directory('Relocated library'),instrument);
    return {tracks:audit.w.snapshot.tracks.map(t=>[t.name,t.instrument.type,t.instrument.patch.length]),
      tapeId:tape.tape.id,projectTapeId:audit.w.snapshot.tracks[2].instrument.tape.id,sampler:verified.ref,valid:verified.ok};
  },saved.instrument);
  assert.deepEqual(loaded.tracks,[['Analog','analog',80],['FM','analog',169],['Mellotron','mellotron',80],['Sampler','sampler',80]]);
  assert.equal(loaded.tapeId,loaded.projectTapeId);
  assert.equal(loaded.sampler.path,'Instruments/Relocated stereo');
  assert.equal(loaded.sampler.revision,1);
  assert(loaded.valid);
  const files=await exportAudio('stems','relocated-stems');
  assert.equal(files.length,4);
  const stems=files.map(([name,wav],index)=>{
    assert.equal(name,`0${index+1} - ${tracks[index]}.wav`);
    return wavData(wav,`mixed-stem-${index+1}`);
  });
  const master=wavData((await exportAudio('mix','relocated-master'))[0][1],'mixed-master');
  const peaks=stems.map((pcm,index)=>{
    const at=startFrames[index]+1500;
    assert.equal(peak(pcm,0,Math.max(1,startFrames[index]-256)),0,tracks[index]);
    const level=peak(pcm,at,4096);
    assert(level>100,`${tracks[index]} stem is silent`);
    assert(peak(master,at,4096)>100,`${tracks[index]} missing from master`);
    return level;
  });
  const start=startFrames[3]+1024,stereo=frequency.map((hz,channel)=>{
    const level=magnitude(stems[3],channel,start,hz);
    const other=magnitude(stems[3],1-channel,start,hz);
    assert(level>4800&&other<level*.03,`Sampler LR level ${level} leakage ${other}`);
    assert(Math.abs(magnitude(master,channel,start,hz)/level-1)<.1);
    return level;
  });
  const beforeClip=activePcm(samplerBefore),afterClip=activePcm(stems[3]);
  const onsetDifferenceFrames=afterClip.onset-beforeClip.onset;
  assert(Math.abs(onsetDifferenceFrames)<=128,`Sampler timing shifted ${onsetDifferenceFrames} frames`);
  assert(Buffer.from(beforeClip.pcm.buffer,beforeClip.pcm.byteOffset,beforeClip.pcm.byteLength)
    .equals(Buffer.from(afterClip.pcm.buffer,afterClip.pcm.byteOffset,afterClip.pcm.byteLength)),
    'Sampler waveform changed after relocating the library');
  const runtime=await page.evaluate(()=>({contexts:audit.contexts,hostNodes:audit.hostNodes,picks:audit.picks}));
  assert.deepEqual(runtime,{contexts:1,hostNodes:1,picks:1});
  assert.deepEqual(errors,[]);
  const report={result:'PASS',chrome:await context.browser().version(),tracks:loaded.tracks,peaks,stereo,
    samplerPcmIdenticalAfterAlignment:true,onsetDifferenceFrames,revision:loaded.sampler.revision,tapeFiles:tapes.length,
    tapeSource:fs.existsSync(exportedTape)?'sampler-converted-WAVs':'synthetic-WAV',directoryHandle:'OPFS',
    restartedBrowser:true,physicalHardware:false,...runtime};
  fs.writeFileSync(path.join(evidence,'mixed-browser.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
