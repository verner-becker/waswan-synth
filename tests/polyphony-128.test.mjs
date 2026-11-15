// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
import {MidiInputController} from '../.local/www/simulator/midi.js';

const bytes=n=>fs.readFileSync(new URL(`../.local/build/waswan-${n}.wasm`,import.meta.url));
const seed=fs.readFileSync(new URL('../upstream/SMKSYNTH/web/simulator/factory-session.bin',import.meta.url));
const session=()=>seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength);
const chord=Array.from({length:128},(_,i)=>i);
const midi=(e,st,d1,d2)=>e.input({t:'midi',st,d1,d2});
const on=(e,n)=>midi(e,0x90,n,100),off=(e,n)=>midi(e,0x80,n,0);
const state=e=>e.frame().polyphony;
const gates=e=>state(e).slots.filter(v=>v.gate);
const active=e=>state(e).slots.filter(v=>v.active);
const mode=(e,m,p=0)=>{e.input({t:'voice-mode',part:p,mode:m});e.advance(30);};
function fixture(n=128) {const e=new Engine(bytes(n),session());e.advance(5000);mode(e,0);return e;}

{
 const e=fixture();assert.equal(state(e).limit,128);assert.equal(state(e).slots.length,128);
 assert.equal(e.ex.waswan_held_limit(),128);assert.equal(e.ex.waswan_event_limit(),512);
 assert.equal(e.ex.waswan_midi_event_limit(),512);assert.equal(e.ex.waswan_group_mask_bits(),128);
 assert.equal(e.ex.waswan_internal_frames(),256);assert.equal(state(e).unisonLimit,8);
 chord.forEach(n=>on(e,n));e.advance(80);
 assert.equal(gates(e).length,128);assert.equal(new Set(gates(e).map(v=>v.sequence)).size,128);
 assert.deepEqual(gates(e).map(v=>v.note).sort((a,b)=>a-b),chord);
 assert(state(e).slots[0].gate);assert(state(e).slots[127].gate);
 // The 129th event must retrigger a valid MIDI note, not invent note 128.
 const previous=gates(e).find(v=>v.note===64).sequence;on(e,64);e.advance(30);
 assert.equal(gates(e).length,128);assert(gates(e).find(v=>v.note===64).sequence>previous);
 chord.forEach(n=>off(e,n));e.render(512);assert.equal(gates(e).length,0);assert.equal(active(e).length,128);
 e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();
 for(let count=1;count<=128;count++){on(e,count-1);e.advance(20);assert.equal(gates(e).length,count);}
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: progressive 1–128 notes, complete MIDI 0–127 batch, retrigger, note-off and release');

// DUAL fills 128 cards with 64 distinct pitches, leaving a valid 65th MIDI pitch for stealing.
{
 const e=fixture();mode(e,1);chord.slice(0,64).forEach(n=>on(e,n));e.advance(100);
 assert.equal(gates(e).length,128);assert.equal(new Set(gates(e).map(v=>v.note)).size,64);
 on(e,64);e.advance(20);assert.equal(gates(e).length,128);
 assert(!gates(e).some(v=>v.note===0));assert.equal(gates(e).filter(v=>v.note===64).length,2);
 off(e,0);e.advance(20);assert.equal(gates(e).length,128);
 chord.slice(0,65).forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();chord.forEach(n=>on(e,n));e.advance(80);off(e,127);e.render(512);
 assert.equal(gates(e).length,127);assert.equal(active(e).length,128);
 on(e,127);e.advance(20);assert.equal(gates(e).length,128);assert(gates(e).some(v=>v.note===0));
}
{
 const e=fixture();e.input({t:'voice-sustain',enabled:true});e.advance(20);
 for(let i=0;i<128;i+=8){chord.slice(i,i+8).forEach(n=>on(e,n));e.advance(40);chord.slice(i,i+8).forEach(n=>off(e,n));e.advance(30);}
 assert.equal(gates(e).length,128);assert.equal(e.ex.waswan_held(0),128);
 e.input({t:'voice-sustain',enabled:false});e.advance(2500);assert.equal(active(e).length,0);assert.equal(e.ex.waswan_held(0),0);
}
console.log('PASS: allocations beyond 128 in DUAL, stealing/released-first and 128-note sustain/pedal-up');

{
 const e=fixture();chord.forEach(n=>on(e,n));e.advance(100);
 for(let i=0;i<256;i++)midi(e,0xb0,119,i&127);
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0,'384-message batch must retain note-offs');
 chord.forEach(n=>on(e,n));midi(e,0xb0,64,127);chord.forEach(n=>off(e,n));midi(e,0xb0,64,0);
 e.advance(2500);assert.equal(active(e).length,0);assert.equal(e.ex.waswan_held(0),0);
}
console.log('PASS: 384-message parser batch and 258-message full on/off/pedal batch');

// Groups cross every 32-bit word boundary and occupy bit 127 without oversized shifts.
for(const start of [28,60,92,120]){
 const e=fixture();chord.slice(0,start).forEach(n=>on(e,n));e.advance(80);
 mode(e,2);e.input({t:'voice-unison',part:0,count:8});on(e,127);e.advance(80);
 assert.equal(gates(e).length,start+8);
 for(let i=start;i<start+8;i++){assert(state(e).slots[i].gate);assert.equal(state(e).slots[i].note,127);}
 e.input({t:'panic'});e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();chord.slice(0,96).forEach(n=>on(e,n));e.advance(80);e.input({t:'analog',part:3});e.advance(100);
 for(let p=0;p<4;p++){
  if(p){e.input({t:'enc',e:5,steps:1});e.advance(100);}
  assert.equal(e.ex.sim_track(),p);mode(e,2,p);e.input({t:'voice-unison',part:p,count:8});
  midi(e,0xb0,61,0);e.advance(40);on(e,100+3*p);e.advance(80);
  assert.equal(gates(e).length,96+8*(p+1));
 }
 for(let p=0;p<4;p++)assert.equal(gates(e).filter(v=>v.part===p).length,p===0?104:8);
 assert(state(e).slots[127].gate);assert.equal(new Set(gates(e).map(v=>v.sequence)).size,128);
 e.input({t:'panic'});e.advance(20);assert.equal(gates(e).length,0);e.advance(20000);assert.equal(active(e).length,0);
}
console.log('PASS: mask boundaries 31/32, 63/64, 95/96, bit 127 and four shared groups');

{
 const e=fixture();mode(e,3);chord.forEach(n=>on(e,n));e.advance(100);assert.equal(gates(e).length,1);
 off(e,127);e.advance(30);assert.equal(gates(e)[0].note,126);
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
 midi(e,0xb0,20,127);mode(e,0);chord.forEach(n=>on(e,n));e.advance(100);
 assert.equal(gates(e).length,5);assert.equal(state(e).parts[0].limit,5);
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();chord.forEach(n=>on(e,n));e.advance(80);assert.equal(gates(e).length,128);
 midi(e,0xb0,20,127);e.advance(100);
 assert.equal(gates(e).length,5);assert.equal(active(e).length,5,'switching a full pool to SUPER must retire excess cards');
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();midi(e,0xb0,61,26);midi(e,0xb0,62,127);midi(e,0xb0,63,127);e.advance(30);
 chord.forEach(n=>on(e,n));e.advance(80);assert.equal(e.ex.waswan_held(0),128);
 const heard=new Set();for(let i=0;i<2000;i++){e.advance(20);for(const v of gates(e))heard.add(v.note);}
 assert(heard.has(0));assert(heard.has(127));
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);assert.equal(e.ex.waswan_held(0),0);
}
console.log('PASS: MONO full held list, SUPER cap and 128-note/four-octave arpeggiator including note zero');

{
 const a=fixture(64),b=fixture(128);chord.slice(0,64).forEach(n=>{on(a,n);on(b,n);});
 for(let i=0;i<350;i++){
  a.render(128);b.render(128);for(const ptr of ['sim_out_l','sim_out_r'])assert.deepEqual(
   new Float32Array(a.ex.memory.buffer,a.ex[ptr](),128),new Float32Array(b.ex.memory.buffer,b.ex[ptr](),128));
 }
 assert.deepEqual(a.store(true),b.store(true));
 for(let p=0;p<4;p++)for(let n=0;n<a.ex.waswan_parameter_count();n++)assert.equal(a.ex.sim_param(p,n),b.ex.sim_param(p,n));
}
const benchmark=[];
for(const count of [64,128]){
 const e=fixture(count);chord.slice(0,count).forEach(n=>on(e,n));e.advance(100);
 let peak=0,energy=0,clipped=0;const times=[],blocks=Math.ceil(44100*10/128),started=performance.now();
 for(let i=0;i<blocks;i++){
  const before=performance.now();e.render(128);times.push(performance.now()-before);
  for(const ptr of ['sim_out_l','sim_out_r'])for(const v of new Float32Array(e.ex.memory.buffer,e.ex[ptr](),128)){
   assert(Number.isFinite(v));peak=Math.max(peak,Math.abs(v));energy+=v*v;if(Math.abs(v)>=32767/32768)clipped++;
  }
 }
 const elapsed=performance.now()-started;times.sort((a,b)=>a-b);const p99=times[Math.floor(times.length*.99)];
 assert(energy>0);assert(peak<1);assert.equal(clipped,0);assert(elapsed<5000);assert(p99<128/44.1);
 benchmark.push({voices:count,seconds:10,renderMs:Math.round(elapsed),p99QuantumMs:p99,quantumBudgetMs:128/44.1,peak,clipped,maskBits:e.ex.waswan_group_mask_bits(),voiceStateBytes:e.ex.waswan_voice_state_bytes(),heldStateBytes:e.ex.waswan_held_state_bytes(),queueBytes:e.ex.waswan_queue_bytes(),memoryBytes:e.ex.memory.buffer.byteLength});
}
fs.mkdirSync(new URL('../.local/validation/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../.local/validation/polyphony-128-benchmark.json',import.meta.url),JSON.stringify(benchmark,null,2));
console.log(JSON.stringify(benchmark));
console.log('PASS: first-sixty-four stereo regression, presets/session equality and 128-voice processing margin');

{
 const e=fixture();globalThis.localStorage={getItem(){return null;},setItem(){}};
 const port={id:'master',name:'SMK-37 Pro-Master',state:'connected',async open(){},async close(){}};
 const controller=new MidiInputController({navigator:{async requestMIDIAccess(){return {inputs:new Map([['master',port]])};}},secureContext:true,send:m=>e.input(m),isRunning:()=>true});
 await controller.connect();controller.profile.setEnabled(true);controller.profile.learn('enc:0','absolute');
 port.onmidimessage({data:[0xb5,48,20]});port.onmidimessage({data:[0xb5,48,21]});e.advance(30);
 chord.forEach(n=>port.onmidimessage({data:[0x90,n,100]}));e.advance(100);assert.equal(controller.notes.size,128);assert.equal(gates(e).length,128);
 port.onmidimessage({data:[0xe0,127,127]});port.onmidimessage({data:[0xb0,1,127]});e.advance(100);
 assert(e.ex.sim_synth_bend()>0);assert(e.ex.sim_synth_vibrato()>0);assert.equal(gates(e).length,128);
 e.input({t:'voice-sustain',enabled:true});await controller.select('');e.advance(2500);
 assert.equal(active(e).length,0);assert(!state(e).midiSustain);assert.equal(controller.profile.bindings.length,1);
}
console.log('PASS: full MIDI 0–127 through profile, pitch/modulation, sustain/disconnect and preserved mappings');
