// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
import {MidiInputController} from '../.local/www/simulator/midi.js';

const bytes=n=>fs.readFileSync(new URL(`../.local/build/waswan-${n}.wasm`,import.meta.url));
const seed=fs.readFileSync(new URL('../upstream/SMKSYNTH/web/simulator/factory-session.bin',import.meta.url));
const session=()=>seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength);
const chord=Array.from({length:16},(_,i)=>48+i);
const midi=(e,st,d1,d2)=>e.input({t:'midi',st,d1,d2});
const on=(e,n)=>midi(e,0x90,n,100),off=(e,n)=>midi(e,0x80,n,0);
const state=e=>e.frame().polyphony;
const gates=e=>state(e).slots.filter(v=>v.gate);
const active=e=>state(e).slots.filter(v=>v.active);
const mode=(e,m,p=0)=>{e.input({t:'voice-mode',part:p,mode:m});e.advance(30);};
function fixture(n=16) { const e=new Engine(bytes(n),session());e.advance(5000);mode(e,0);return e; }

{
 const e=fixture();assert.equal(state(e).limit,16);assert.equal(state(e).unisonLimit,8);
 assert.equal(e.ex.waswan_held_limit(),16);assert.equal(e.ex.waswan_event_limit(),64);
 assert.equal(e.ex.waswan_internal_frames(),256);
 assert.equal(state(e).slots.length,16);
}
for(let count=1;count<=16;count++) {
 const e=fixture();chord.slice(0,count).forEach(n=>on(e,n));e.advance(80);
 assert.equal(gates(e).length,count);
 assert.deepEqual(gates(e).map(v=>v.note).sort((a,b)=>a-b),chord.slice(0,count));
 assert.equal(new Set(gates(e).map(v=>v.sequence)).size,count);
 chord.slice(0,count).forEach(n=>off(e,n));e.render(512);
 assert.equal(gates(e).length,0);assert.equal(active(e).length,count);
 e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: 1–16 simultaneous notes, upper voice slots, note-offs and release');

{
 const e=fixture();chord.forEach(n=>on(e,n));e.advance(100);
 on(e,72);e.advance(20);assert.equal(gates(e).length,16);
 assert(!gates(e).some(v=>v.note===48));assert(gates(e).some(v=>v.note===72));
 off(e,48);e.advance(20);assert.equal(gates(e).length,16);
 [...chord,72].forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();chord.forEach(n=>on(e,n));e.advance(80);
 off(e,63);e.render(512);assert.equal(gates(e).length,15);assert.equal(active(e).length,16);
 on(e,72);e.advance(20);
 assert(gates(e).some(v=>v.note===48));assert(!gates(e).some(v=>v.note===63));assert.equal(gates(e).length,16);
}
console.log('PASS: seventeenth-note stealing, oldest held, released-first and stale note-off');

{
 const e=fixture();e.input({t:'voice-sustain',enabled:true});e.advance(20);
 assert(state(e).midiSustain);
 for(const half of [chord.slice(0,8),chord.slice(8)]){
  half.forEach(n=>on(e,n));e.advance(50);half.forEach(n=>off(e,n));e.advance(30);
 }
 assert.equal(gates(e).length,16);assert.equal(e.ex.waswan_held(0),16);
 on(e,72);off(e,72);e.advance(20);assert.equal(gates(e).length,16);
 e.input({t:'voice-sustain',enabled:false});e.advance(2500);
 assert.equal(active(e).length,0);assert.equal(e.ex.waswan_held(0),0);
 // External CC64 still uses the original path and updates the UI state.
 midi(e,0xb0,64,127);chord.forEach(n=>on(e,n));e.advance(50);
 chord.forEach(n=>off(e,n));e.advance(30);assert.equal(gates(e).length,16);
 assert(state(e).midiSustain);midi(e,0xb0,64,0);e.advance(2500);assert.equal(active(e).length,0);
 for(let i=0;i<40;i++){on(e,60);e.advance(5);}
 midi(e,0x90,60,0);e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: two sustained batches of eight, sustain beyond pool capacity, pedal-up and retriggers');

// Two eight-voice groups force group_pick's taken mask to cover bits 8–15.
{
 const e=fixture();mode(e,2);e.input({t:'voice-unison',part:0,count:8});on(e,60);e.advance(80);
 assert.equal(gates(e).length,8);
 e.input({t:'enc',e:5,steps:1});e.advance(100);assert.equal(e.ex.sim_track(),1);
 mode(e,2,1);e.input({t:'voice-unison',part:1,count:8});on(e,67);e.advance(80);
 assert.equal(gates(e).length,16);
 assert.equal(gates(e).filter(v=>v.part===0).length,8);assert.equal(gates(e).filter(v=>v.part===1).length,8);
 assert.equal(new Set(state(e).slots.filter(v=>v.active).map(v=>v.sequence)).size,16);
 e.input({t:'voice-unison',part:1,count:16});assert.equal(e.ex.waswan_unison(1),8,'unison metadata cap is preserved');
 e.input({t:'panic'});e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();mode(e,1);chord.slice(0,8).forEach(n=>on(e,n));e.advance(100);
 assert.equal(gates(e).length,16);assert.equal(new Set(gates(e).map(v=>v.note)).size,8);
 chord.slice(0,8).forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
 mode(e,3);chord.forEach(n=>on(e,n));e.advance(80);assert.equal(gates(e).length,1);
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();midi(e,0xb0,20,127);e.advance(50);
 chord.forEach(n=>on(e,n));e.advance(100);
 assert.equal(state(e).parts[0].limit,5);assert.equal(gates(e).length,5);
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: upper-bit group allocation, two shared UNISON groups, DUAL eight notes, MONO and SUPER five-card cap');

// First eight idle slots retain exact audio and the same persistent representation.
{
 const a=fixture(8),b=fixture(16);
 chord.slice(0,8).forEach(n=>{on(a,n);on(b,n);});
 for(let i=0;i<350;i++) {
  a.render(128);b.render(128);
  for(const ptr of ['sim_out_l','sim_out_r'])assert.deepEqual(
   new Float32Array(a.ex.memory.buffer,a.ex[ptr](),128),new Float32Array(b.ex.memory.buffer,b.ex[ptr](),128));
 }
 assert.deepEqual(a.store(true),b.store(true),'preset/session representation unchanged');
 for(let p=0;p<4;p++)for(let n=0;n<a.ex.waswan_parameter_count();n++)assert.equal(a.ex.sim_param(p,n),b.ex.sim_param(p,n));
}

// Compare DSP cost using the same block size and workload shape; test actual 16-voice output.
const benchmark=[];
for(const count of [8,16]){
 const e=fixture(count);chord.slice(0,count).forEach(n=>on(e,n));e.advance(100);
 let peak=0,energy=0,clipped=0;const times=[],blocks=Math.ceil(44100*10/128),started=performance.now();
 for(let i=0;i<blocks;i++){
  const before=performance.now();e.render(128);times.push(performance.now()-before);
  for(const ptr of ['sim_out_l','sim_out_r'])for(const v of new Float32Array(e.ex.memory.buffer,e.ex[ptr](),128)){
   assert(Number.isFinite(v));peak=Math.max(peak,Math.abs(v));energy+=v*v;if(Math.abs(v)>=32767/32768)clipped++;
  }
 }
 const elapsed=performance.now()-started;times.sort((a,b)=>a-b);
 assert(energy>0);assert(peak<1);assert.equal(clipped,0,'saw chord should retain output headroom');
 assert(elapsed<5000,'10 seconds must render with at least 2x real-time headroom');
 assert(times[Math.floor(times.length*.99)]<128/44.1,'p99 processing should stay below an audio quantum');
 benchmark.push({voices:count,seconds:10,renderMs:Math.round(elapsed),p99QuantumMs:times[Math.floor(times.length*.99)],quantumBudgetMs:128/44.1,peak,clipped,voiceStateBytes:e.ex.waswan_voice_state_bytes(),memoryBytes:e.ex.memory.buffer.byteLength});
}
fs.mkdirSync(new URL('../.local/validation/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../.local/validation/polyphony-16-benchmark.json',import.meta.url),JSON.stringify(benchmark,null,2));
console.log(JSON.stringify(benchmark));
console.log('PASS: first-eight audio regression, presets/session equality, 16-voice headroom and DSP cost comparison');

{
 const e=fixture();globalThis.localStorage={getItem(){return null;},setItem(){}};
 const port={id:'master',name:'SMK-37 Pro-Master',state:'connected',async open(){},async close(){}};
 const controller=new MidiInputController({navigator:{async requestMIDIAccess(){return{inputs:new Map([['master',port]])};}},secureContext:true,send:m=>e.input(m),isRunning:()=>true});
 await controller.connect();controller.profile.setEnabled(true);controller.profile.learn('enc:0','absolute');
 port.onmidimessage({data:[0xb5,48,40]});port.onmidimessage({data:[0xb5,48,41]});e.advance(30);
 chord.forEach(n=>port.onmidimessage({data:[0x90,n,100]}));e.advance(100);
 assert.equal(controller.notes.size,16);assert.equal(gates(e).length,16);
 e.input({t:'voice-sustain',enabled:true});await controller.select('');e.advance(2500);
 assert.equal(active(e).length,0);assert(!state(e).midiSustain);assert.equal(controller.profile.bindings.length,1);
}
console.log('PASS: sixteen notes through MIDI profile and safe disconnect with sustain');
