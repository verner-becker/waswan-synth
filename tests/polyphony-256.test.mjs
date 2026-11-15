// SPDX-License-Identifier: GPL-3.0-only
// Experimental pool: MIDI pitches remain 0–127; voices may layer or overlap.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
import {MidiInputController} from '../.local/www/simulator/midi.js';
const bytes=n=>fs.readFileSync(new URL(`../.local/build/waswan-${n}.wasm`,import.meta.url));
const seed=fs.readFileSync(new URL('../upstream/SMKSYNTH/web/simulator/factory-session.bin',import.meta.url));
const pitches=Array.from({length:128},(_,i)=>i);
const midi=(e,st,d1,d2)=>e.input({t:'midi',st,d1,d2});
const on=(e,n)=>midi(e,0x90,n,100),off=(e,n)=>midi(e,0x80,n,0);
const state=e=>e.frame().polyphony,gates=e=>state(e).slots.filter(v=>v.gate),active=e=>state(e).slots.filter(v=>v.active);
const mode=(e,m,p=0)=>{e.input({t:'voice-mode',part:p,mode:m});e.advance(30);};
function fixture(n=256){const e=new Engine(bytes(n),seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));e.advance(5000);mode(e,0);return e;}
function select(e,p){e.input({t:'enc',e:5,steps:p-e.ex.sim_track()});e.advance(100);assert.equal(e.ex.sim_track(),p);}
function prepareParts(e){
 // Original GLOBAL page: base channel 1 routes channels 2–4 directly to B–D.
 e.input({t:'btn',b:10,down:true});e.advance(80);e.input({t:'btn',b:10,down:false});e.advance(150);
 e.input({t:'enc',e:2,steps:1});e.advance(100);
 midi(e,0xc1,70,0);e.advance(200);mode(e,0,1);
}
const polyOn=(e,i)=>midi(e,i<128?0x90:0x91,i%128,100);
const polyOff=e=>{for(const n of pitches){off(e,n);midi(e,0x81,n,0);}};
function polyFill(e,count=256){for(let i=0;i<count;i++)polyOn(e,i);e.advance(80);}
function empty(e,ms=2500){e.advance(ms);assert.equal(active(e).length,0);}

{
 const e=fixture();prepareParts(e);assert.equal(state(e).limit,256);assert.equal(state(e).slots.length,256);
 assert.equal(e.ex.waswan_group_mask_bits(),256);assert.equal(e.ex.waswan_held_limit(),128);
 assert.equal(e.ex.waswan_event_limit(),1024);assert.equal(e.ex.waswan_midi_event_limit(),1024);
 assert.equal(e.ex.waswan_internal_frames(),256);assert.equal(state(e).unisonLimit,8);
 for(let count=1;count<=256;count++){polyOn(e,count-1);e.advance(10);assert.equal(gates(e).length,count);}
 assert.equal(e.ex.waswan_held(0),128);assert(state(e).slots[255].gate);
 assert.equal(new Set(gates(e).map(v=>v.sequence)).size,256);
 for(const n of pitches)assert.equal(gates(e).filter(v=>v.note===n).length,2);
 midi(e,0x91,64,100);e.advance(20);assert.equal(gates(e).length,256);
 assert.equal(gates(e).filter(v=>v.note===0).length,1);assert.equal(gates(e).filter(v=>v.note===64).length,3);
 off(e,0);e.advance(20);assert.equal(gates(e).length,256);assert.equal(gates(e).filter(v=>v.note===64).length,3);
 polyOff(e);e.render(512);assert.equal(gates(e).length,0);assert.equal(active(e).length,256);empty(e);
}
console.log('PASS: progressive 1–256 POLY cards, two parts with valid MIDI pitches, slot 255, 257th allocation, note-off/release');
{
 const e=fixture();prepareParts(e);mode(e,1);mode(e,1,1);pitches.forEach(n=>on(e,n));e.advance(80);
 assert.equal(gates(e).length,256);for(const n of pitches)assert.equal(gates(e).filter(v=>v.note===n).length,2);
 const old=gates(e).filter(v=>v.note===0).map(v=>v.sequence);
 midi(e,0x91,0,100);e.advance(30);assert.equal(gates(e).length,256);
 assert(gates(e).filter(v=>v.note===0).every(v=>!old.includes(v.sequence)));
 off(e,0);e.advance(20);assert.equal(gates(e).length,256);
 polyOff(e);empty(e);
}
{
 const e=fixture();prepareParts(e);polyFill(e);off(e,127);midi(e,0x81,127,0);e.render(512);assert.equal(gates(e).length,254);
 on(e,127);midi(e,0x91,127,100);e.advance(20);assert.equal(gates(e).length,256);
 assert.equal(gates(e).filter(v=>v.note===0).length,2,'released cards precede held cards');
}
{
 const e=fixture();mode(e,1);e.input({t:'voice-sustain',enabled:true});e.advance(20);
 for(let i=0;i<128;i+=8){pitches.slice(i,i+8).forEach(n=>on(e,n));e.advance(30);pitches.slice(i,i+8).forEach(n=>off(e,n));e.advance(20);}
 assert.equal(gates(e).length,256);assert.equal(e.ex.waswan_held(0),128);
 e.input({t:'voice-sustain',enabled:false});empty(e);assert.equal(e.ex.waswan_held(0),0);
}
console.log('PASS: DUAL 128 pitches/256 voices, released-first, sustain and pedal-up');

// Separate parts own their pitches: note-off in B must preserve A's identical pitches.
{
 const e=fixture();prepareParts(e);pitches.forEach(n=>on(e,n));e.advance(80);
 pitches.forEach(n=>midi(e,0x91,n,100));e.advance(80);assert.equal(gates(e).length,256);
 for(const p of [0,1]){assert.equal(gates(e).filter(v=>v.part===p).length,128);assert.equal(e.ex.waswan_held(p),128);}
 pitches.forEach(n=>midi(e,0x81,n,0));e.advance(30);assert.equal(gates(e).length,128);assert(gates(e).every(v=>v.part===0));
 select(e,0);pitches.forEach(n=>off(e,n));empty(e,20000);
}
// Group selection crosses all eight mask words; no out-of-range uint8 slot at 255.
for(const start of [28,60,92,124,156,188,220,248]){
 const e=fixture();prepareParts(e);polyFill(e,start);mode(e,2,1);e.input({t:'voice-unison',part:1,count:8});midi(e,0x91,127,100);e.advance(60);
 assert.equal(gates(e).length,start+8);
 for(let i=start;i<start+8;i++){assert(state(e).slots[i].gate);assert.equal(state(e).slots[i].note,127);}
 e.input({t:'panic'});empty(e);
}
{
 const e=fixture();prepareParts(e);for(let i=0;i<224;i++)midi(e,0x91,i%128,100);e.advance(80);e.input({t:'analog',part:3});e.advance(100);
 for(let p=0;p<4;p++){
  select(e,p);mode(e,2,p);e.input({t:'voice-unison',part:p,count:8});midi(e,0xb0,61,0);e.advance(30);midi(e,0x90+p,100+3*p,100);e.advance(60);
  assert.equal(gates(e).length,224+8*(p+1));
 }
 assert(state(e).slots[255].gate);assert.equal(new Set(gates(e).map(v=>v.sequence)).size,256);
 for(let p=0;p<4;p++)assert.equal(gates(e).filter(v=>v.part===p).length,p===1?232:8);
 e.input({t:'panic'});e.advance(20);assert.equal(gates(e).length,0);empty(e,20000);
}
console.log('PASS: two POLY parts, pitch ownership, seven word boundaries, bit 255 and four upper groups');
{
 const e=fixture();prepareParts(e);polyFill(e);
 for(let i=0;i<512;i++)midi(e,0xb0,119,i&127);
 polyOff(e);empty(e);
 for(let i=0;i<256;i++)polyOn(e,i);midi(e,0xb0,64,127);polyOff(e);midi(e,0xb0,64,0);
 empty(e);assert.equal(e.ex.waswan_held(0),0);
}
{
 const e=fixture();prepareParts(e);polyFill(e);midi(e,0xb0,20,127);midi(e,0xb1,20,127);e.advance(100);
 assert.equal(gates(e).length,5);assert.equal(active(e).length,5);assert.equal(state(e).parts[0].limit,5);
 polyOff(e);empty(e);
}
console.log('PASS: 768-message queue, 514-message on/off/pedal batch and full-pool SUPER transition');

{
 const a=fixture(128),b=fixture();pitches.forEach(n=>{on(a,n);on(b,n);});
 for(let i=0;i<350;i++){
  a.render(128);b.render(128);for(const ptr of ['sim_out_l','sim_out_r'])assert.deepEqual(new Float32Array(a.ex.memory.buffer,a.ex[ptr](),128),new Float32Array(b.ex.memory.buffer,b.ex[ptr](),128));
 }
 assert.deepEqual(a.store(true),b.store(true));
 for(let p=0;p<4;p++)for(let n=0;n<a.ex.waswan_parameter_count();n++)assert.equal(a.ex.sim_param(p,n),b.ex.sim_param(p,n));
}
const benchmark=[];
for(const count of [128,256]){
 const e=fixture(count);if(count===256)prepareParts(e);polyFill(e,count);
 let peak=0,energy=0,clipped=0;const times=[],blocks=Math.ceil(44100*10/128),started=performance.now();
 for(let i=0;i<blocks;i++){
  const before=performance.now();e.render(128);times.push(performance.now()-before);
  for(const ptr of ['sim_out_l','sim_out_r'])for(const v of new Float32Array(e.ex.memory.buffer,e.ex[ptr](),128)){
   assert(Number.isFinite(v));peak=Math.max(peak,Math.abs(v));energy+=v*v;if(Math.abs(v)>=32767/32768)clipped++;
  }
 }
 const elapsed=performance.now()-started;times.sort((a,b)=>a-b);const p99=times[Math.floor(times.length*.99)];
 benchmark.push({voices:count,seconds:10,renderMs:Math.round(elapsed),p99QuantumMs:p99,quantumBudgetMs:128/44.1,peak,clipped,finite:true,nonzero:energy>0,maskBits:e.ex.waswan_group_mask_bits(),voiceStateBytes:e.ex.waswan_voice_state_bytes(),heldStateBytes:e.ex.waswan_held_state_bytes(),queueBytes:e.ex.waswan_queue_bytes(),memoryBytes:e.ex.memory.buffer.byteLength});
}
fs.mkdirSync(new URL('../.local/validation/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../.local/validation/polyphony-256-benchmark.json',import.meta.url),JSON.stringify(benchmark,null,2));
console.log(JSON.stringify(benchmark));
for(const result of benchmark){assert(result.nonzero);assert(result.peak<1);assert.equal(result.clipped,0);assert(result.renderMs<5000);assert(result.p99QuantumMs<result.quantumBudgetMs);}
console.log('PASS: 128-voice stereo/preset/session regression and 256-voice processing margin');
{
 const e=fixture();mode(e,1);globalThis.localStorage={getItem(){return null;},setItem(){}};
 const port={id:'master',name:'SMK-37 Pro-Master',state:'connected',async open(){},async close(){}};
 const controller=new MidiInputController({navigator:{async requestMIDIAccess(){return {inputs:new Map([['master',port]])};}},secureContext:true,send:m=>e.input(m),isRunning:()=>true});
 await controller.connect();controller.profile.setEnabled(true);controller.profile.learn('enc:0','absolute');
 port.onmidimessage({data:[0xb5,48,20]});port.onmidimessage({data:[0xb5,48,21]});e.advance(30);
 pitches.forEach(n=>port.onmidimessage({data:[0x90,n,100]}));e.advance(80);assert.equal(controller.notes.size,128);assert.equal(gates(e).length,256);
 port.onmidimessage({data:[0xe0,127,127]});port.onmidimessage({data:[0xb0,1,127]});e.advance(80);
 assert(e.ex.sim_synth_bend()>0);assert(e.ex.sim_synth_vibrato()>0);assert.equal(gates(e).length,256);
 e.input({t:'voice-sustain',enabled:true});await controller.select('');empty(e);assert(!state(e).midiSustain);assert.equal(controller.profile.bindings.length,1);
}
console.log('PASS: 256 DUAL voices through MIDI/profile, pitch/modulation, sustain/disconnect and mappings');
