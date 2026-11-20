// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime, packSampler} from '../../web/sampler-runtime.js';
import {createInstrument, compile, explainNote} from '../../web/sampler-instrument.js';

const e = new Engine(fs.readFileSync('.local/build/waswan-256.wasm'),
  fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
e.advance(4000);
const x=e.ex, runtime=new SamplerRuntime(x);
assert(x.waswan_mel_patch());
assert(x.waswan_daw_apply(1,x.waswan_daw_token()));
x.waswan_daw_taps(1);
const ref = {libraryId:'test', instrumentId:'piano', revision:1};
const sample = {id:'impulse', path:'Samples/impulse.wav', sha256:'1'.repeat(64),sampleRate:44100,channels:2,frames:4096};
const pcm = new Int16Array(sample.frames*2);
pcm[80*2]=16000;
pcm[240*2+1]=-8000;
const base={id:'note',sample:'impulse',group:'main',root:60};
const instrument=createInstrument({id:ref.instrumentId,revision:1,samples:[sample],regions:[base]});
function begin(ref, instrument) {
  return runtime.command({t:'daw-sampler-begin',request:crypto.randomUUID(),ref,packed:packSampler(instrument)});
}
function install(ref, instrument, data = pcm) {
  const {token,sampleIds}=begin(ref,instrument);
  for(const sampleId of sampleIds)for(let offset=0;offset<data.length;offset+=32768)
    runtime.command({t:'daw-sampler-chunk',token,sampleId,offset,pcm:data.subarray(offset,offset+32768)});
  runtime.command({t:'daw-sampler-commit',token});
  return sampleIds;
}
function bind(ref) {
  runtime.applySlots(runtime.prepareSlots([{...ref,trackId:'track-A',type:'sampler',part:0}]));
}
function capture(frames=8192, live=false) {
  const channels = [new Float32Array(frames),new Float32Array(frames)];
  for(let i=0;i<frames;i+=128){
    e.render(128);
    for(let c=0;c<2;c++) {
      const ptr=live?x.waswan_daw_live_output(0,c):x.waswan_daw_owned_output(0,c);
      channels[c].set(new Float32Array(x.memory.buffer,ptr,128),i);
    }
  }
  return channels;
}
const note=(n,v)=>assert(x.waswan_daw_note(0,n,v));
const active=()=>Array.from({length:256},(_,i)=>x.waswan_sampler_voice_region(i)).filter(Boolean);
assert.deepEqual(install(ref,instrument),['impulse']);
bind(ref);
function peaks(noteNumber) {
  note(noteNumber,100);
  const channels=capture();
  note(noteNumber,0);
  return channels.map(c=>[...c.entries()].filter(([,v])=>Math.abs(v)>0.0001));
}
const [left,right]=peaks(60);
assert.equal(left.length,1);assert.equal(right.length,1);
assert.equal(right[0][0]-left[0][0],160);
assert.equal(left[0][1],16000/32768);assert.equal(right[0][1],-8000/32768);
const [upL, upR]=peaks(72);
assert(Math.abs(upR[0][0]-upL[0][0]-80)<=1);
const revision={...ref,revision:2};
let pending=begin(revision,{...instrument,revision:2,samples:[{...sample,sha256:'2'.repeat(64)}]});
assert.throws(()=>runtime.command({t:'daw-sampler-commit',token:pending.token}),/Incomplete/);
runtime.command({t:'daw-sampler-cancel',token:pending.token});
assert.throws(()=>runtime.command({t:'daw-sampler-chunk',token:pending.token,sampleId:sample.id,offset:0,pcm}),/expired/);
assert.deepEqual(peaks(60).map(ch=>ch.map(([,v])=>v)),[[16000/32768],[-8000/32768]]);

const regions = [];
for(const layer of ['soft','hard'])for(const member of ['a','b'])regions.push({...base,id:layer+member,
  layer,variation:{set:layer,member},loop:{start:0,end:4096}});
regions.push({...base,id:'release',trigger:'release'});
regions.push({...base,id:'felt',articulation:'felt'});
const piano=createInstrument({...instrument,revision:2,regions,
  layers:[{id:'soft',velocity:[1,80],fadeOut:[64,80]},{id:'hard',velocity:[64,127],fadeIn:[64,80]}],
  variations:[{id:'soft',mode:'sequential',order:['a','b']},{id:'hard',mode:'random',seed:11,avoidRepeat:true,order:['a','b']}],
  articulations:[{id:'felt',select:{keyswitch:24}}]});
assert.deepEqual(install(revision,piano),[],'second revision shares original PCM');
bind(revision);
const plan=compile(piano);
let state;
const expectNote=(n,v)=>{
  const chosen=explainNote(plan,{type:v?'noteOn':'noteOff',note:n,velocity:v},state);
  state=chosen.state;
  return chosen.voices.map(voice=>regions.findIndex(region=>region.id===voice.regionId)+1);
};
for(let i=0;i<4;i++) {
  const expected=expectNote(60,72);note(60,72);
  assert.deepEqual(active().sort(),expected.sort());
  for(let slot=0;slot<256;slot++)if(x.waswan_sampler_voice_region(slot))
    assert(Math.abs(x.waswan_sampler_voice_gain(slot)-Math.SQRT1_2)<0.0001);
  expectNote(60,0);note(60,0);assert(active().includes(5));
  capture();
}
expectNote(24,100);note(24,100);assert.equal(active().length,0);
expectNote(24,0);note(24,0);
const expected=expectNote(60,72);note(60,72);assert.deepEqual(active().sort(),expected.sort());
const oldActive=active().length;
bind(ref);note(64,100);assert.equal(active().length,oldActive+1,'held voices survived revision switch');
note(60,0);note(64,0);capture();assert.equal(active().length,0);
bind(revision);
assert(x.waswan_daw_live_note_channel(0,2,60,72));
assert(x.waswan_daw_live_pedal_channel(0,2,1));
assert(x.waswan_daw_live_note_channel(0,2,60,0));assert(!active().includes(5));
assert(x.waswan_daw_live_pedal_channel(0,2,0));assert(active().includes(5));
capture(8192,true);assert.equal(active().length,0);
assert.equal(x.waswan_voice_limit(),256);
console.log('Sampler host passed stereo impulse isolation, transposition, stale and partial uploads, deduplication, live generation swap, fade and variation parity, keyswitch, pedal and release.');

const seq=(n,v,ch,id)=>assert(x.waswan_sampler_note_id(0,n,v,ch,id));
runtime.resetSequence();
seq(60,72,1,1);seq(60,72,1,2);seq(60,72,2,3);
assert.equal(active().length,6);
seq(60,0,1,2);seq(60,0,1,2);capture(8192);
assert.equal(active().length,4,'a duplicate or stale Note Off cannot release its pitch siblings');
seq(60,0,1,1);seq(60,0,2,3);capture();assert.equal(active().length,0);
const snap=runtime.sequenceState();
seq(60,72,4,4);const selected=active().sort();seq(60,0,4,4);capture();
runtime.restoreSequenceState(snap);seq(60,72,4,5);assert.deepEqual(active().sort(),selected);
x.waswan_daw_stop(1);capture(256);assert.equal(active().length,0);

const loadRef={...ref,revision:3};
const load=createInstrument({...instrument,revision:3,regions:[{...base,loop:{start:0,end:4096}}]});
install(loadRef,load);bind(loadRef);
for(let id=1;id<=256;id++)seq(60,100,0,id);
assert.equal(active().length,256);
seq(60,100,0,257);seq(60,0,0,1);
assert.equal(active().length,256,'the stolen gesture cannot release its successor');
const timings=[];
for(let i=0;i<256;i++) {
  const start=performance.now();e.render(128);timings.push(performance.now()-start);
}
timings.sort((a,b)=>a-b);
const report={voices:256,stereoChannels:2,blockFrames:128,blocks:timings.length,
  p50Ms:timings[128],p95Ms:timings[243],p99Ms:timings[253],maxMs:timings.at(-1),
  linearMemoryBytes:x.memory.buffer.byteLength};
fs.mkdirSync('.local/validation/sampler-studio-1',{recursive:true});
fs.writeFileSync('.local/validation/sampler-studio-1/host.json',JSON.stringify(report,null,2));
console.log(report);
x.waswan_daw_stop(1);capture(512);assert.equal(active().length,0);

// Matching notes in preview, sequenced playback and live monitoring belong to different gestures.
seq(60,100,0,800);
assert(x.waswan_daw_live_note_channel(0,0,60,100));
const beforePreview=runtime.sequenceState(0,0);
assert(x.waswan_sampler_preview_begin(0));
assert(x.waswan_sampler_preview_note(0,60,100));
assert.equal(active().length,3);
assert(x.waswan_sampler_preview_end(0));
assert.equal(active().length,2);
assert.deepEqual(runtime.sequenceState(0,0)[0].bytes,beforePreview[0].bytes);
assert(x.waswan_sampler_preview_begin(0));
assert(x.waswan_sampler_preview_note(0,60,100));
x.waswan_daw_stop(1);assert.equal(active().length,2);
x.waswan_daw_live_stop_channel(0,0,1);assert.equal(active().length,1);
assert(x.waswan_sampler_preview_end(0));assert.equal(active().length,0);

const singles={...ref,revision:4};
const oneShot=createInstrument({...instrument,revision:4,regions:[{...base,mode:'oneShot'}]});
install(singles,oneShot);bind(singles);
note(60,110);note(60,0);
const [shotLeft,shotRight]=capture();
assert(shotLeft.some(value=>value===16000/32768));
assert(shotRight.some(value=>value===-8000/32768));
assert.equal(active().length,0,'one-shot releases its global slot at sample end');

const tooLarge={...ref,revision:5};
assert.throws(()=>begin(tooLarge,{...instrument,revision:5,
  samples:[{...sample,frames:24000000}]}),/memory budget/);
assert.deepEqual(peaks(60).map(ch=>ch.map(([,v])=>v)),[[16000/32768],[-8000/32768]]);
console.log('Sampler preview isolation, per-channel selection snapshots, one-shot and active-generation budget fallback passed.');
