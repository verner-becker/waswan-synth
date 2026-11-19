// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {Engine} from '../../.local/www/simulator/engine.js';
import {readSample} from './wav.mjs';
import {amplitude, directory, hz, notes, writeFixture} from './fixture.mjs';

const bytes = writeFixture();
const {pcm} = await readSample(new Blob([bytes]), 60);
assert.equal(pcm.length, 88200);
for (const [offset, value] of [[22,2],[24,48000],[4,22],[40,1]]) {
  const invalid = Buffer.from(bytes);
  invalid.writeUInt16LE(value,offset);
  await assert.rejects(readSample(new Blob([invalid]),60));
}
const baseline = fs.readFileSync('.local/www/simulator/obervave-voice.wasm');
const probe = fs.readFileSync('.local/www/mellotron-a/simulator/obervave-voice.wasm');
const seed = fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
function host(wasm, load) {
  const e = new Engine(wasm, seed), x = e.ex;
  if (load) {
    assert.equal(x.waswan_probe_install(88201,60),0);
    assert.equal(x.waswan_probe_install(pcm.length,60),1);
    new Int16Array(x.memory.buffer,x.waswan_probe_pcm(),pcm.length).set(pcm);
    assert.equal(x.waswan_probe_install(pcm.length,60),0);
  }
  e.advance(5000);
  assert.equal(x.waswan_voice_limit(),256);
  assert(x.waswan_daw_program(0,68));
  const patch = new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer(),80);
  patch[38]=0; patch[39]=1; patch[24]=0; patch[26]=127; patch[27]=0; patch[47]=0;
  assert(x.waswan_daw_apply(1,x.waswan_daw_token()));
  x.waswan_daw_taps(1);
  return e;
}
function midi(e,note,on) {e.input({t:'midi',st:on?144:128,d1:note,d2:on?100:0});}
const plain = host(baseline,false), disabled = host(probe,false), active = host(probe,true);
for(const e of [plain,disabled,active]) notes.forEach(n=>midi(e,n,true));
for(let i=0;i<90;i++) {
  for(const e of [plain,disabled,active])e.render(128);
  for(const name of ['sim_out_l','sim_out_r']){
    const block=e=>new Float32Array(e.ex.memory.buffer,e.ex[name](),128);
    assert.deepEqual(block(plain),block(disabled));
  }
}
const held=e=>e.frame().polyphony.slots.filter(v=>v.gate).length;
assert.equal(held(active),3);
const x=active.ex;
const dry=new Float32Array(8192*2);
for(let at=0;at<8192;at+=128){
  active.render(128);
  for(let ch=0;ch<2;ch++){
    const block=new Float32Array(x.memory.buffer,x.waswan_daw_output(0,ch),128);
    for(let i=0;i<128;i++)dry[2*(at+i)+ch]=block[i];
  }
}
const peak=dry.reduce((max,s)=>Math.max(max,Math.abs(s)),0);
assert(peak>0 && peak<1,'Unexpected full-scale clipping in the reference chord: '+peak);
const tones=notes.map(n=>amplitude(dry,0,8192,hz(n)));
assert(Math.min(...tones)>8*amplitude(dry,0,8192,375));
assert(x.waswan_daw_note(0,60,100));active.advance(30);assert.equal(held(active),4);
assert(x.waswan_daw_note(0,60,0));active.advance(30);assert.equal(held(active),3);
for(const n of notes)midi(active,n,false);
active.advance(1500);assert.equal(held(active),0);
for(const field of ['waswan_daw_output','waswan_daw_owned_output'])
  assert(new Float32Array(x.memory.buffer,x[field](0,0),128).every(s=>s===0));

// Alternate order after warmup. Re-trigger every 64 blocks so one-shots
// remain audible throughout each timing interval.
function batch(e,chord){
  let elapsed=0;
  for(let j=0;j<8;j++){
    for(const n of chord)midi(e,n,true);
    const t=performance.now();
    for(let i=0;i<64;i++)e.render(128);
    elapsed+=performance.now()-t;
    for(const n of chord)midi(e,n,false);
    e.advance(100);
  }
  return elapsed/512;
}
for(const e of [plain,active]){for(const n of notes)midi(e,n,false);e.advance(1000);}
const timings={};
for(const chord of [notes,Array.from({length:12},(_,i)=>60+i)]){
  const times={baseline:[],sample:[]};
  for(const e of [plain,active]){
    for(const n of chord)midi(e,n,true);
    e.advance(50);
    assert.equal(held(e),chord.length);
    for(const n of chord)midi(e,n,false);
    e.advance(100);
    batch(e,chord);
  }
  for(let i=0;i<5;i++)
    for(const key of (i%2?['sample','baseline']:['baseline','sample']))
      times[key].push(batch(key==='sample'?active:plain,chord));
  timings[chord.length]=times;
}
const report={blockFrames:128,meanMsPerBlockByVoiceCount:timings,
  baselineHeap:plain.ex.memory.buffer.byteLength,probeHeap:x.memory.buffer.byteLength,
  pcmBytes:pcm.byteLength,sharedSlots:256,disabledBitIdentical:true,independentNoteOff:true,
  peak,tones};
fs.writeFileSync(directory+'/host.json',JSON.stringify(report,null,2));
console.log(report);
