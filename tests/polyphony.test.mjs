// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
import {Engine as OriginalEngine} from '../upstream/SMKSYNTH/web/simulator/engine.js';
import {MidiInputController} from '../.local/www/simulator/midi.js';

const wasm=fs.readFileSync(new URL('../.local/build/waswan-8.wasm',import.meta.url));
const originalWasm=fs.readFileSync(new URL('../.local/build/SMKSYNTH-1.2.0.wasm',import.meta.url));
const seed=fs.readFileSync(new URL('../upstream/SMKSYNTH/web/simulator/factory-session.bin',import.meta.url));
const session=()=>seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength);
const chord=[48,52,55,60,64,67,72,76];
const slots=e=>e.frame().polyphony.slots;
const gates=e=>slots(e).filter(v=>v.gate);
const active=e=>slots(e).filter(v=>v.active);
const params=e=>Array.from({length:4},(_,p)=>Array.from({length:e.ex.waswan_parameter_count()},(_,i)=>e.ex.sim_param(p,i)));
function fixture() {
 const e=new Engine(wasm,session());e.advance(5000);return e;
}
const mode=(e,m,part=0)=>{e.input({t:'voice-mode',part,mode:m});e.advance(30);};
const midi=(e,status,n,v)=>e.input({t:'midi',st:status,d1:n,d2:v});
const on=(e,n,v=100)=>midi(e,0x90,n,v);
const off=(e,n)=>midi(e,0x80,n,0);
const tap=(e,b)=>{e.input({t:'btn',b,down:true});e.advance(60);e.input({t:'btn',b,down:false});e.advance(100);};

// Reproduce the actual starting session, rather than assuming the INIT name is POLY.
{
 const e=fixture();assert.equal(e.ex.waswan_voice_limit(),8);
 assert.equal(e.ex.sim_program(0)+1,71);assert.equal(e.ex.waswan_mode(0),3);
 assert.equal(e.ex.sim_param(0,0),1);assert.equal(e.ex.sim_param(0,4),1);
 chord.forEach(n=>on(e,n));e.advance(100);
 assert.equal(gates(e).length,1);assert.equal(gates(e)[0].note,76);
 off(e,76);e.advance(20);assert.equal(gates(e)[0].note,72,'MONO last-note fallback');
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: factory saw in MONO reproduces physical symptom; note priority and fallback');

// Mode edit must not replace the saw sound, other parts, MIDI settings or stored bank.
{
 const e=fixture(),before=params(e),hash=e.ex.sim_store_hash(),writes=e.frame().writes;
 mode(e,0);const after=params(e);
 assert.equal(after[0][38],0);before[0][38]=0;assert.deepEqual(after,before);
 assert.equal(e.ex.sim_program(0)+1,71);assert.equal(e.ex.sim_store_hash(),hash);
 assert.deepEqual(e.frame().writes,writes,'no implicit SAVE/factory rewrite');
 for(const bad of [{part:-1,mode:0},{part:4,mode:0},{part:0,mode:4},{part:0,mode:1.5}])e.input({t:'voice-mode',...bad});
 assert.equal(e.ex.waswan_mode(0),0);
}
console.log('PASS: POLY changes only P_MODE; saw/presets/other parts/session stay intact');

for(let count=1;count<=8;count++) {
 const e=fixture();mode(e,0);
 chord.slice(0,count).forEach(n=>on(e,n));e.advance(80);
 assert.equal(gates(e).length,count);
 assert.deepEqual(gates(e).map(v=>v.note).sort((a,b)=>a-b),chord.slice(0,count));
 assert.equal(new Set(gates(e).map(v=>v.sequence)).size,count);
 assert(e.ex.sim_peak()>0,'polyphonic chord produces audio');
 chord.slice(0,count).forEach(n=>off(e,n));e.render(512);
 assert.equal(gates(e).length,0);assert.equal(active(e).length,count,'release occupies slots after note-off');
 e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: simultaneous 1–8 note chords, distinct allocation, note-off and release tails');

// A ninth note steals the oldest held voice; releasing the stolen pitch cannot kill its replacement.
{
 const e=fixture();mode(e,0);chord.forEach(n=>on(e,n));e.advance(100);
 const oldest=gates(e).reduce((a,b)=>a.sequence<b.sequence?a:b);
 assert.equal(oldest.note,48);
 on(e,79);e.advance(20);assert.equal(gates(e).length,8);
 assert(!gates(e).some(v=>v.note===48));assert(gates(e).some(v=>v.note===79));
 off(e,48);e.advance(20);assert.equal(gates(e).length,8);
 [...chord,79].forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
// Released voices take priority over held voices even when the released note is newer.
{
 const e=fixture();mode(e,0);chord.forEach(n=>on(e,n));e.advance(80);
 off(e,76);e.render(512);assert.equal(active(e).length,8);assert.equal(gates(e).length,7);
 on(e,79);e.advance(10);
 assert(gates(e).some(v=>v.note===48));assert(!gates(e).some(v=>v.note===76));assert.equal(gates(e).length,8);
}
console.log('PASS: steal oldest held/released-first, stale note-off does not release replacement');

{
 const e=fixture();mode(e,0);chord.forEach(n=>on(e,n));e.advance(80);
 midi(e,0xb0,64,127);chord.forEach(n=>off(e,n));e.advance(100);
 assert.equal(gates(e).length,8);assert(e.frame().polyphony.parts[0].sustain);
 midi(e,0xb0,64,0);e.render(512);assert.equal(gates(e).length,0);
 assert.equal(active(e).length,8);e.advance(2500);assert.equal(active(e).length,0);
 // Note On with velocity zero is also a note-off.
 on(e,60);e.advance(50);on(e,60,0);e.advance(2500);assert.equal(active(e).length,0);
 // Duplicate retriggers must eventually release without stranded voices.
 for(let i=0;i<12;i++){on(e,60);e.advance(10);}
 off(e,60);e.advance(2500);assert.equal(active(e).length,0);
 // Panic during sustain.
 on(e,60);midi(e,0xb0,64,127);e.advance(80);
 e.input({t:'panic'});e.advance(2500);assert.equal(active(e).length,0);
}
console.log('PASS: sustain/pedal-up, zero velocity, retriggers and panic without stranded voices');

for(const [m,voices,notes] of [[3,1,1],[1,8,4],[2,4,1]]) {
 const e=fixture();mode(e,m);chord.forEach(n=>on(e,n));e.advance(100);
 assert.equal(gates(e).length,voices);assert.equal(new Set(gates(e).map(v=>v.note)).size,notes);
 chord.forEach(n=>off(e,n));e.advance(2500);assert.equal(active(e).length,0);
}
{
 const e=fixture();mode(e,2);e.input({t:'voice-unison',part:0,count:8});on(e,60);e.advance(80);
 assert.equal(gates(e).length,8);assert.equal(new Set(gates(e).map(v=>v.note)).size,1);
 e.input({t:'voice-unison',part:0,count:9});assert.equal(e.ex.waswan_unison(0),8);
 mode(e,0);off(e,60);e.advance(2500);assert.equal(active(e).length,0,'mode edit while held releases old group');
}
console.log('PASS: MONO/DUAL/UNISON budgets, unison 1–8 bounds and mode transitions');

// Shared pool: sequencer plus live chords cannot allocate beyond eight.
{
 const e=fixture();mode(e,0);tap(e,16);chord.forEach(n=>on(e,n));
 for(let i=0;i<50;i++){e.advance(20);assert(active(e).length<=8);}
 tap(e,16);chord.forEach(n=>off(e,n));e.input({t:'panic'});e.advance(2500);
 assert.equal(active(e).length,0);
}
// SUPER retains the original five-card ceiling, without replacing the patch with another preset.
{
 const e=fixture();mode(e,0);
 midi(e,0xb0,20,127);e.advance(40); // Original firmware CC20: OSC1 WAVE -> SUPER.
 assert.equal(e.ex.sim_param(0,0),4);assert.equal(e.frame().polyphony.parts[0].limit,5);
 chord.forEach(n=>on(e,n));e.advance(100);assert.equal(gates(e).length,5);
}
console.log('PASS: eight-card pool remains shared with sequencer; SUPER ceiling stays five');

// Original and extended WASM produce identical stereo samples when no new mode edits are used.
{
 const a=new Engine(wasm,session()),b=new OriginalEngine(originalWasm,session());
 for(const e of [a,b]){e.advance(5000);on(e,60);}
 for(let block=0;block<250;block++) {
  for(const e of [a,b])e.render(128);
  for(const ptr of ['sim_out_l','sim_out_r'])assert.deepEqual(
   new Float32Array(a.ex.memory.buffer,a.ex[ptr](),128),new Float32Array(b.ex.memory.buffer,b.ex[ptr](),128));
 }
 assert.deepEqual(a.store(true),b.store(true));
}
// Eight held voices at AudioWorklet block size: finite output and real-time performance headroom.
let peak=0,energy=0;
{
 const e=fixture();mode(e,0);chord.forEach(n=>on(e,n));e.advance(100);
 const started=performance.now(),blocks=Math.ceil(44100*10/128);
 for(let i=0;i<blocks;i++){
  e.render(128);
  for(const ptr of ['sim_out_l','sim_out_r'])for(const value of new Float32Array(e.ex.memory.buffer,e.ex[ptr](),128)){
   assert(Number.isFinite(value));peak=Math.max(peak,Math.abs(value));energy+=value*value;
  }
 }
 const elapsed=performance.now()-started;
 assert(energy>0);assert(peak<1);assert(elapsed<5000,'10 seconds should render with at least 2x real-time headroom');
 console.log(JSON.stringify({voices:8,seconds:10,renderMs:Math.round(elapsed),peak,energy}));
}

// Physical MIDI adapter + mappings + DSP: eight independent notes and safe disconnect.
{
 const e=fixture();mode(e,0);globalThis.localStorage={getItem(){return null;},setItem(){}};
 const port={id:'master',name:'SMK-37 Pro-Master',state:'connected',async open(){},async close(){}};
 const controller=new MidiInputController({navigator:{async requestMIDIAccess(){return{inputs:new Map([['master',port]])};}},secureContext:true,send:m=>e.input(m),isRunning:()=>true});
 await controller.connect();
 controller.profile.setEnabled(true);controller.profile.learn('enc:0','absolute');
 port.onmidimessage({data:[0xb5,48,40]});port.onmidimessage({data:[0xb5,48,41]});e.advance(30);
 assert.equal(controller.profile.bindings.length,1);
 chord.forEach(n=>port.onmidimessage({data:[0x90,n,100]}));e.advance(100);
 assert.equal(controller.notes.size,8);assert.equal(gates(e).length,8);
 port.onmidimessage({data:[0xb0,64,127]});e.advance(20);
 await controller.select('');e.advance(2500);assert.equal(active(e).length,0);
 assert.equal(controller.profile.bindings.length,1,'disconnect keeps mappings');
}
console.log('PASS: audio/session regression, eight-voice performance, MIDI mappings and disconnect');
