// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
import {MidiInputController} from '../.local/www/simulator/midi.js';

const bytes=n=>fs.readFileSync(new URL(`../.local/build/waswan-${n}.wasm`,import.meta.url));
const seed=fs.readFileSync(new URL('../upstream/SMKSYNTH/web/simulator/factory-session.bin',import.meta.url));
const session=()=>seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength);
const chord=Array.from({length:32},(_,i)=>48+i);
const midi=(e,st,d1,d2)=>e.input({t:'midi',st,d1,d2});
const on=(e,n)=>midi(e,0x90,n,100),off=(e,n)=>midi(e,0x80,n,0);
const state=e=>e.frame().polyphony;
const gates=e=>state(e).slots.filter(v=>v.gate);
const active=e=>state(e).slots.filter(v=>v.active);
const mode=(e,m,p=0)=>{e.input({t:'voice-mode',part:p,mode:m});e.advance(30);};
function fixture(n=32) {const e=new Engine(bytes(n),session());e.advance(5000);mode(e,0);return e;}

{
 const e=fixture();assert.equal(state(e).limit,32);assert.equal(state(e).slots.length,32);
 assert.equal(e.ex.waswan_held_limit(),32);assert.equal(e.ex.waswan_event_limit(),128);
 assert.equal(e.ex.waswan_midi_event_limit(),128);assert.equal(e.ex.waswan_internal_frames(),256);
 assert.equal(state(e).unisonLimit,8);
}
for(let count=1;count<=32;count++) {
 const e=fixture();chord.slice(0,count).forEach(n=>on(e,n));e.advance(80);
 assert.equal(gates(e).length,count);assert.equal(new Set(gates(e).map(v=>v.sequence)).size,count);
 assert.deepEqual(gates(e).map(v=>v.note).sort((a,b)=>a-b),chord.slice(0,count));
 chord.slice(0,count).forEach(n=>off(e,n));e.render(512);
 assert.equal(gates(e).length,0);assert.equal(active(e).length,count);
 e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: chords 1–32, all slots including 31, note-off and release');

{
 const e=fixture();chord.forEach(n=>on(e,n));e.advance(100);
 on(e,80);e.advance(20);assert.equal(gates(e).length,32);
 assert(!gates(e).some(v=>v.note===48));assert(gates(e).some(v=>v.note===80));
 off(e,48);e.advance(20);assert.equal(gates(e).length,32);
 [...chord,80].forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();chord.forEach(n=>on(e,n));e.advance(80);
 off(e,79);e.render(512);assert.equal(gates(e).length,31);assert.equal(active(e).length,32);
 on(e,80);e.advance(20);assert(gates(e).some(v=>v.note===48));assert(!gates(e).some(v=>v.note===79));
}
{
 const e=fixture();e.input({t:'voice-sustain',enabled:true});e.advance(20);
 for(let i=0;i<32;i+=8){chord.slice(i,i+8).forEach(n=>on(e,n));e.advance(40);chord.slice(i,i+8).forEach(n=>off(e,n));e.advance(30);}
 assert.equal(gates(e).length,32);assert.equal(e.ex.waswan_held(0),32);
 on(e,80);off(e,80);e.advance(20);assert.equal(gates(e).length,32);
 e.input({t:'voice-sustain',enabled:false});e.advance(2500);
 assert.equal(active(e).length,0);assert.equal(e.ex.waswan_held(0),0);
}
console.log('PASS: 33rd-note stealing, released-first, stale note-off, four sustained batches and pedal-up');

// Test the parser beyond its former 64-event capacity, using a batch that was previously unsafe.
{
 const e=fixture();chord.forEach(n=>on(e,n));e.advance(100);
 for(let i=0;i<64;i++)midi(e,0xb0,119,i); // unmapped control, still occupies the MIDI parser queue
 chord.forEach(n=>off(e,n));e.advance(2500);
 assert.equal(active(e).length,0,'96-event batch must not drop the final note-offs');
 // Full chord, sustain changes and note-offs in one 66-message batch.
 chord.forEach(n=>on(e,n));midi(e,0xb0,64,127);chord.forEach(n=>off(e,n));midi(e,0xb0,64,0);
 e.advance(2500);assert.equal(active(e).length,0);assert.equal(e.ex.waswan_held(0),0);
}
console.log('PASS: 96-message parser batch and 66-message on/off/pedal batch without stuck notes');

// Four groups of eight exercise group_pick through bit 31 of its uint32_t mask.
{
 const e=fixture();e.input({t:'analog',part:3});e.advance(100);
 for(let p=0;p<4;p++){
  if(p){e.input({t:'enc',e:5,steps:1});e.advance(100);}
  assert.equal(e.ex.sim_track(),p);mode(e,2,p);e.input({t:'voice-unison',part:p,count:8});
  midi(e,0xb0,61,0);e.advance(40); // Disable the factory part B arpeggiator through its original CC.
  on(e,60+3*p);e.advance(80);assert.equal(gates(e).length,8*(p+1));
 }
 for(let p=0;p<4;p++)assert.equal(gates(e).filter(v=>v.part===p).length,8);
 assert(state(e).slots[31].active);assert.equal(new Set(gates(e).map(v=>v.sequence)).size,32);
 e.input({t:'panic'});e.advance(20);assert.equal(gates(e).length,0);
 e.advance(20000);assert.equal(active(e).length,0,'factory pad release tails must eventually finish');
}
{
 const e=fixture();mode(e,1);chord.slice(0,16).forEach(n=>on(e,n));e.advance(100);
 assert.equal(gates(e).length,32);assert.equal(new Set(gates(e).map(v=>v.note)).size,16);
 chord.slice(0,16).forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
 mode(e,3);chord.forEach(n=>on(e,n));e.advance(100);assert.equal(gates(e).length,1);
 off(e,79);e.advance(30);assert.equal(gates(e)[0].note,78);
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();midi(e,0xb0,20,127);e.advance(50);chord.forEach(n=>on(e,n));e.advance(100);
 assert.equal(gates(e).length,5);assert.equal(state(e).parts[0].limit,5);
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: mask bit 31, four UNISON groups, DUAL 16 notes, MONO and unchanged SUPER cap');

{
 const a=fixture(16),b=fixture(32);chord.slice(0,16).forEach(n=>{on(a,n);on(b,n);});
 for(let i=0;i<350;i++){
  a.render(128);b.render(128);
  for(const ptr of ['sim_out_l','sim_out_r'])assert.deepEqual(new Float32Array(a.ex.memory.buffer,a.ex[ptr](),128),new Float32Array(b.ex.memory.buffer,b.ex[ptr](),128));
 }
 assert.deepEqual(a.store(true),b.store(true));
 for(let p=0;p<4;p++)for(let n=0;n<a.ex.waswan_parameter_count();n++)assert.equal(a.ex.sim_param(p,n),b.ex.sim_param(p,n));
}

const benchmark=[];
for(const count of [16,32]){
 const e=fixture(count);chord.slice(0,count).forEach(n=>on(e,n));e.advance(100);
 let peak=0,energy=0,clipped=0;const times=[],blocks=Math.ceil(44100*10/128),started=performance.now();
 for(let i=0;i<blocks;i++){
  const before=performance.now();e.render(128);times.push(performance.now()-before);
  for(const ptr of ['sim_out_l','sim_out_r'])for(const v of new Float32Array(e.ex.memory.buffer,e.ex[ptr](),128)){
   assert(Number.isFinite(v));peak=Math.max(peak,Math.abs(v));energy+=v*v;if(Math.abs(v)>=32767/32768)clipped++;
  }
 }
 const elapsed=performance.now()-started;times.sort((a,b)=>a-b);
 assert(energy>0);assert(peak<1);assert.equal(clipped,0);assert(elapsed<5000);
 const p99=times[Math.floor(times.length*.99)];assert(p99<128/44.1);
 benchmark.push({voices:count,seconds:10,renderMs:Math.round(elapsed),p99QuantumMs:p99,quantumBudgetMs:128/44.1,peak,clipped,voiceStateBytes:e.ex.waswan_voice_state_bytes(),heldStateBytes:e.ex.waswan_held_state_bytes(),queueBytes:e.ex.waswan_queue_bytes(),memoryBytes:e.ex.memory.buffer.byteLength});
}
fs.mkdirSync(new URL('../.local/validation/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../.local/validation/polyphony-32-benchmark.json',import.meta.url),JSON.stringify(benchmark,null,2));
console.log(JSON.stringify(benchmark));
console.log('PASS: first-sixteen stereo regression, unchanged presets/session, finite audio and processing margin');

{
 const e=fixture();globalThis.localStorage={getItem(){return null;},setItem(){}};
 const port={id:'master',name:'SMK-37 Pro-Master',state:'connected',async open(){},async close(){}};
 const controller=new MidiInputController({navigator:{async requestMIDIAccess(){return {inputs:new Map([['master',port]])};}},secureContext:true,send:m=>e.input(m),isRunning:()=>true});
 await controller.connect();controller.profile.setEnabled(true);controller.profile.learn('enc:0','absolute');
 port.onmidimessage({data:[0xb5,48,20]});port.onmidimessage({data:[0xb5,48,21]});e.advance(30);
 chord.forEach(n=>port.onmidimessage({data:[0x90,n,100]}));e.advance(100);
 assert.equal(controller.notes.size,32);assert.equal(gates(e).length,32);
 e.input({t:'voice-sustain',enabled:true});await controller.select('');e.advance(2500);
 assert.equal(active(e).length,0);assert(!state(e).midiSustain);assert.equal(controller.profile.bindings.length,1);
}
console.log('PASS: 32 notes through MIDI profile, sustain/disconnect/panic and preserved mappings');
