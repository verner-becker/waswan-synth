// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
const wasm=fs.readFileSync('.local/build/waswan-256.wasm'),seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
function fixture(){const e=new Engine(wasm,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));e.advance(5000);e.ex.waswan_daw_taps(1);return e;}
const patches=e=>Array.from({length:8},(_,p)=>Array.from({length:80},(_,i)=>e.ex.waswan_daw_patch(p,i)));
const final=(e,n)=>[e.ex.sim_out_l(),e.ex.sim_out_r()].map(ptr=>new Float32Array(e.ex.memory.buffer,ptr,n).slice());
const dry=(e,p,n)=>new Float32Array(e.ex.memory.buffer,e.ex.waswan_daw_owned_output(p,0),n);
const own=e=>e.frame().polyphony.slots.filter((v,i)=>v.gate&&e.ex.waswan_voice(i,6)===3);
function stage(e,parts,superWave=false){
  const x=e.ex;
  for(const p of parts){assert(x.waswan_daw_program(p,64));const bytes=new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer()+p*80,80);bytes[0]=superWave?4:1;bytes[4]=0;bytes[12]=60+(p%6)*10;bytes[24]=0;bytes[26]=127;bytes[38]=0;bytes[39]=1;bytes[47]=0;assert.equal(x.waswan_daw_staged_engine(p),0);}
  assert.equal(x.waswan_daw_apply(parts.reduce((n,p)=>n|(1<<p),0),x.waswan_daw_token()),1);
}
const e=fixture(),x=e.ex;assert.equal(x.waswan_daw_capacity(),8);assert.equal(x.waswan_voice_limit(),256);assert.equal(x.waswan_daw_drum_hits(),32);
stage(e,[0,1,2,3,4,5]);for(let p=0;p<6;p++)assert(x.waswan_daw_note(p,48+p*3,100));
const energies=Array(6).fill(0);
for(let block=0;block<128;block++){
  e.render(128);assert(final(e,128).every(a=>a.every(v=>v===0)),'DAW voices must not also enter Legacy stereo');
  for(let p=0;p<6;p++)for(const v of dry(e,p,128)){assert(Number.isFinite(v));energies[p]+=Math.abs(v);}
}
assert(energies.every(n=>n>0));assert.equal(own(e).length,6);
const before=patches(e);assert(x.waswan_daw_parameter(5,12,127));for(let p=0;p<5;p++)assert.deepEqual(patches(e)[p],before[p]);
assert.equal(x.waswan_studio_mix_set(4,0,10),0,'Studio stays in its original four-part domain');
assert(x.waswan_daw_note(4,60,0));assert.equal(own(e).filter(v=>v.part===4).length,0);assert.equal(own(e).length,5);
e.input({t:'midi',st:144,d1:72,d2:100});e.advance(50);assert(e.frame().polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===72));
x.waswan_daw_stop(1);assert.equal(own(e).length,0);assert(e.frame().polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===72),'DAW Stop cannot release live notes');
const unchanged=patches(e);assert(x.waswan_daw_program(4,64));new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer()+4*80,80)[12]=255;
assert.equal(x.waswan_daw_apply(16,x.waswan_daw_token()),0);assert.deepEqual(patches(e),unchanged,'invalid staged patch never partially applies');
// Extra slots must not read/expand the four-part DRUM-X pool.
const bytes=new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer()+4*80,80);bytes.fill(0);bytes.set([79,86,69,1,2,167],74);
assert.equal(x.waswan_daw_staged_engine(4),-1);assert.equal(x.waswan_daw_apply(16,x.waswan_daw_token()),0);
// Existing physical sound remains bit-identical with active independent extras,
// including fast random LFOs: extra slots must not consume the Legacy RNG.
const plain=fixture(),layered=fixture();
for(const a of [plain,layered]){a.input({t:'voice-mode',part:0,mode:0});a.ex.waswan_studio_parameter_set(0,28,4);a.ex.waswan_studio_parameter_set(0,29,127);a.input({t:'midi',st:144,d1:60,d2:100});a.advance(100);}
stage(layered,[4,5]);for(const p of [4,5])layered.ex.waswan_daw_note(p,64+p,90);
for(let block=0;block<100;block++){plain.render(512);layered.render(512);assert.deepEqual(final(layered,512),final(plain,512),'independent extras must not change an existing Legacy voice');}
const superTest=fixture();stage(superTest,[0,1,2,3,4,5],true);for(let p=0;p<6;p++)superTest.ex.waswan_daw_note(p,60+p,100);
superTest.render(128);assert(own(superTest).length<=5,'SUPER global ceiling is preserved');assert(final(superTest,128).every(a=>a.every(v=>v===0)),'SUPER steal tails retain DAW output ownership');
for(const mode of [2,3]){
 const mono=fixture(),mx=mono.ex;stage(mono,[0]);mono.ex.waswan_daw_parameter(0,38,mode);if(mode===2)mx.waswan_daw_parameter(0,39,4);const current=patches(mono)[0];
 mono.input({t:'midi',st:144,d1:72,d2:90});mono.advance(40);const liveBefore=mono.frame().polyphony.slots.filter(v=>v.gate&&!v.sequenced).length;assert(liveBefore>0);
 mx.waswan_daw_note(0,60,100);mono.advance(40);assert(own(mono).length>0);mx.waswan_daw_stop(1);
 const restored=mono.frame().polyphony.slots.filter(v=>v.gate&&!v.sequenced&&v.note===72);assert.equal(restored.length,liveBefore,'Stop must restore a held physical key in MONO/UNISON');assert.deepEqual(patches(mono)[0],current);
}
const drum=fixture(),dx=drum.ex;drum.input({t:'drums',part:0,kit:0});drum.advance(100);new Uint8Array(dx.memory.buffer,dx.waswan_daw_stage_buffer(),80).set(patches(drum)[0]);assert(dx.waswan_daw_apply(1,dx.waswan_daw_token()));
dx.sim_drum_hit(0,0,100);dx.waswan_daw_note(0,38,100);drum.render(512);assert(dry(drum,0,512).some(v=>v!==0));dx.waswan_daw_stop(1);drum.render(1024);drum.render(512);
assert(dry(drum,0,512).every(v=>v===0));assert(final(drum,512).some(a=>a.some(v=>v!==0)),'Stop cannot erase a current live drum hit in a different lane');
const full=fixture();stage(full,[0,1,2,3,4,5,6,7]);for(let p=0;p<8;p++)for(let note=36;note<68;note++)assert(full.ex.waswan_daw_note(p,note,90));full.render(1024);assert.equal(own(full).length,256,'eight slots share the same global pool');
for(let p=0;p<8;p++)full.ex.waswan_daw_note(p,90,90);full.render(1024);assert(own(full).length<=256);for(let p=0;p<8;p++)assert([...dry(full,p,1024)].every(Number.isFinite));full.ex.waswan_daw_stop(1);assert.equal(own(full).length,0);
console.log(JSON.stringify({result:'PASS',slots:8,simultaneousIndependentTimbres:6,energies,globalAnalogVoices:256,globalSuperLimit:5,drumHits:32,legacyAudioUnchangedWithExtras:true,ownedOutputsIsolated:true,stopPreservesLiveNotes:true,invalidPatchAtomic:true}));
