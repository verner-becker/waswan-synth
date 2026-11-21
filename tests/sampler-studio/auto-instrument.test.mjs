// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {diskDirectory} from './filesystem.mjs';
import {importOriginal,initializeLibrary} from '../../web/sampler-library.js';
import {openWorking,prepareWorking} from '../../web/sampler-working.js';
import {encodeSample} from '../../web/sampler-offline.js';
import {discoverCandidates,previewProposal,proposeInstrument,proposalMap,saveProposal} from '../../web/sampler-auto-instrument.js';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime} from '../../web/sampler-runtime.js';

const file = encodeSample({channels:1,sampleRate:48000,pcm:Float32Array.from({length:144000},(_,i)=>
  i<24000 || i>=120000 ? 0 : 0.5*Math.sin(2*Math.PI*(i<72000?220:330)*i/48000))});
const silent = encodeSample({channels:1,sampleRate:44100,pcm:new Float32Array(44100)});
assert.deepEqual(await discoverCandidates(silent),[]);
await assert.rejects(proposeInstrument(silent,{start:0,end:44100}),/quiet/);
await assert.rejects(proposeInstrument(file,{start:0,end:20}),/60 ms/);
await assert.rejects(discoverCandidates(file,'Auto',{signal:AbortSignal.abort()}),{name:'AbortError'});
let progress=0;
class WindowedRecording extends Blob {
  arrayBuffer(){throw Error('Discovery read the entire recording');}
  slice(start,end){
    assert(end-start<=48000*2,'Scan must read bounded windows');
    return super.slice(start,end);
  }
}
const recording=new WindowedRecording([file]);
const controller=new AbortController();
await assert.rejects(discoverCandidates(recording,'Auto',{signal:controller.signal,
  onProgress:()=>controller.abort()}),{name:'AbortError'});
const candidates=await discoverCandidates(recording,'Sustained',{onProgress:f=>{assert(f>=progress);progress=f;}});
assert.equal(progress,1);
assert(candidates.length>0 && candidates.length<=5);
for(const n of [57,64]) assert(candidates.some(c=>c.reason.includes('MIDI '+n)));
const result = await proposeInstrument(file,candidates.find(c=>c.reason.includes('MIDI 57')));
assert.equal(result.pitch.root,57);
assert(result.loop && result.loop.start>0 && result.loop.end<result.frames);
assert(result.loop.crossfade>0);
const pluck = encodeSample({channels:1,sampleRate:44100,pcm:Float32Array.from({length:22050},(_,i)=>
  Math.sin(i*0.03)*0.8*Math.exp(-i/1800))});
const hit = await proposeInstrument(pluck,{start:0,end:22050});
assert.equal(hit.character,'Plucked');
assert.equal(hit.loop,null);

const dir=await mkdtemp(join(tmpdir(),'waswan-wizard-'));
try {
  const root=await diskDirectory(dir), library=await initializeLibrary(root);
  const source=await importOriginal(root,file,'Samples/Originals/Vóz.wav');
  const settings={name:'Vóz',id:crypto.randomUUID()};
  const saved=await saveProposal(root,library.id,source,result,settings);
  const opened=await openWorking(root,saved.id);
  assert.deepEqual(opened,saved);
  assert.deepEqual(await saveProposal(root,library.id,source,result,settings),saved);
  await assert.rejects(saveProposal(root,library.id,source,result,{...settings,name:'Another name'}),{code:'working-conflict'});
  assert.equal(saved.rendered.source.sha256,source.sha256);
  assert.equal(saved.rendered.sampleRate,44100);
  assert.equal(saved.baseRef,null);
  assert.deepEqual(saved.instrument.regions[0].envelope,result.envelope);
  const unknown={...result,pitch:{root:null},loop:null};
  assert.throws(()=>proposalMap(saved.rendered,unknown,settings),/root note/);
  assert.deepEqual(proposalMap(saved.rendered,{...unknown,character:'Texture'},settings).regions[0].key,[60,60]);
  const engine=new Engine(await readFile('.local/build/waswan-256.wasm'),
    await readFile('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
  engine.advance(4000);
  const x=engine.ex, runtime=new SamplerRuntime(x), maps=[];
  assert(x.waswan_mel_patch());
  assert(x.waswan_daw_apply(1,x.waswan_daw_token()));
  x.waswan_daw_taps(1);
  const player={requests:()=>({request:async(t,p)=>{
    if(t==='daw-sampler-patch') return {patch:new Uint8Array(512)};
    if(t==='daw-sampler-begin') maps.push(p.packed);
    return runtime.command({t,request:crypto.randomUUID(),...p});
  }})};
  await previewProposal(player,result,settings);
  const ref=await prepareWorking(player,root,opened);
  const [before,after]=maps.map(p=>p.regions[0]);
  assert.deepEqual({...before,sample:after.sample},after);
  assert.equal(maps[0].dependencies[0].sha256,maps[1].dependencies[0].sha256);
  runtime.applySlots(runtime.prepareSlots([{...ref,trackId:'wizard',type:'sampler',part:0}]));
  const note=(n,v)=>assert(x.waswan_daw_note(0,n,v));
  const out=[];
  function capture(blocks) {
    let peak=0;
    for(let i=0;i<blocks;i++){
      engine.render(128);
      const left=new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,0),128);
      const right=new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,1),128);
      for(let f=0;f<128;f++){out.push(left[f],right[f]);peak=Math.max(peak,Math.abs(left[f]),Math.abs(right[f]));}
    }
    return peak;
  }
  note(45,105); note(69,105);
  capture(Math.ceil(result.frames/128)+32);
  const heldPeak=capture(32);
  assert(heldPeak>0.001);
  assert.equal(Array.from({length:256},(_,i)=>x.waswan_sampler_voice_region(i)).filter(Boolean).length,2);
  note(45,0); note(69,0);
  capture(120);
  const releasedPeak=capture(16);
  assert.equal(releasedPeak,0);
  const peak=out.reduce((a,v)=>Math.max(a,Math.abs(v)),0);
  const path='.local/validation/auto-instrument-wizard';
  await mkdir(path,{recursive:true});
  const wav=encodeSample({channels:2,sampleRate:44100,pcm:Float32Array.from(out)});
  await writeFile(join(path,'chord.wav'),new Uint8Array(await wav.arrayBuffer()));
  console.log('PASS candidate discovery, pitch abstention, partial render, playable map, Working reopen and WASM chord',{peak,heldPeak,releasedPeak});
}finally{await rm(dir,{recursive:true,force:true});}
