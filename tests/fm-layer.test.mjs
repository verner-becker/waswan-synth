// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Engine} from '../.local/www/simulator/engine.js';
import {stageTone,toneBytes,validToneBytes} from '../web/fm-patch.js';
import {emptyProject,makeTrack} from '../web/daw-project.js';
import {readProject,projectBlob} from '../web/daw-format.js';

const wasm=fs.readFileSync('.local/build/waswan-256.wasm'),seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
function boot(store=seed){
  const e=new Engine(wasm,store);e.advance(5000);
  choose(e,71);return e;
}
function choose(e,program){
  const x=e.ex;
  assert(x.waswan_program_select(program-1,x.waswan_ui_scope(),x.waswan_program_token(),1));
  e.advance(150);
}
function edit(e,field,value){assert(e.ex.waswan_fm_edit(field,value,e.ex.waswan_ui_scope()),'FM field '+field);}
function analog(e,id,value){assert(e.ex.waswan_editor_set(id,value,e.ex.waswan_ui_scope()));}
function note(e,on,key=60,velocity=95){e.input({t:'midi',st:on?144:128,d1:key,d2:on?velocity:0});}
function audio(e,n=8192,dry=false){
  const samples=[];
  for(let i=0;i<n;i+=128){
    e.render(128);
    samples.push(...new Float32Array(e.ex.memory.buffer,dry?e.ex.waswan_daw_output(0,0):e.ex.sim_out_l(),128));
  }
  assert(samples.every(Number.isFinite));return samples;
}
function pure(e){edit(e,0,1);edit(e,3,0);edit(e,4,127);analog(e,38,0);analog(e,47,0);}
const plain=boot(),added=boot();edit(added,0,1);
for(const e of [plain,added])note(e,true);
assert.deepEqual(audio(plain),audio(added),'adding silent FM preserves original audio');

// Dry per-part samples are Q17. Panning the two sources together can
// differ by one integer step from panning them separately.
const stems=[boot(),boot(),boot()];
for(const [i,synth] of stems.entries()){
  if(i){pure(synth);if(i===2)edit(synth,3,127);}
  analog(synth,38,0);analog(synth,47,0);synth.ex.waswan_daw_taps(1);note(synth,true);
}
const [subtractive,fm,hybrid]=stems.map(synth=>audio(synth,4096,true));
assert(subtractive.some(v=>v!==0)&&fm.some(v=>v!==0));
assert(hybrid.every((v,i)=>Math.abs(v-subtractive[i]-fm[i])<=2/131072),'parallel layer sum');
const e=boot();pure(e);
const x=e.ex;
assert.equal(x.waswan_fm_edit(1,32,x.waswan_ui_scope()),0);
assert.equal(x.waswan_fm_edit(4,50,x.waswan_ui_scope()^1),0);
const routes=Array.from({length:32},(_,alg)=>Array.from({length:6},(_,i)=>x.waswan_fm_route(alg,5-i)));
// Fingerprint of the routing table in Google MSFA, OP6 to OP1.
assert.equal(createHash('sha256').update(Buffer.from(routes.flat())).digest('hex'),'7307d1bc59baf0e588ced8523478fbacbb751bd4699ab80af890e2ffd17044fd');
let hashes=new Set();
for(let alg=0;alg<32;alg++){
  const synth=boot();pure(synth);edit(synth,1,alg);edit(synth,2,7);
  for(let i=0;i<6;i++)edit(synth,5+i*14+1,i+1);
  note(synth,true);const signal=audio(synth,4096);
  assert(signal.some(v=>Math.abs(v)>.0001),'audible algorithm '+(alg+1));
  hashes.add(createHash('sha256').update(new Uint8Array(Float32Array.from(signal).buffer)).digest('hex'));
}
assert.equal(hashes.size,32,'32 distinct routings with feedback');
function carrier({fixed=false,key=60,velocity=100,sensitivity=0,cutoff=100,fine=0}={}){
  const s=boot();pure(s);edit(s,1,31);
  for(let i=1;i<6;i++)edit(s,5+i*14+4,0);
  edit(s,5,+fixed);edit(s,6,fixed?2:1);edit(s,7,fine);edit(s,10,sensitivity);analog(s,12,cutoff);
  s.ex.waswan_daw_taps(1);note(s,true,key,velocity);return audio(s,22016,true).slice(1024);
}
const crossings=a=>a.filter((v,i)=>i&&v>0&&a[i-1]<=0).length;
const ratio=crossings(carrier()),octave=crossings(carrier({key:72})),fixed=crossings(carrier({fixed:true}));
assert(Math.abs(2*ratio-octave)<4,JSON.stringify({ratio,octave,fixed}));assert(Math.abs(fixed-crossings(carrier({fixed:true,key:72})))<2);
assert(crossings(carrier({fine:75}))>ratio*1.6);
assert.deepEqual(carrier({cutoff:0}),carrier({cutoff:127}),'analog filter bypass for FM');
const peak=a=>Math.max(...a.map(Math.abs));
assert(peak(carrier({velocity:120,sensitivity:7}))>2*peak(carrier({velocity:25,sensitivity:7})));
analog(e,27,0);edit(e,14,30);note(e,true);audio(e);
e.input({t:'voice-sustain',enabled:true});note(e,false);audio(e);
assert(e.frame().polyphony.slots.some(s=>s.gate));
e.input({t:'voice-sustain',enabled:false});assert(audio(e).some(v=>v!==0));
e.advance(14000);assert(e.frame().polyphony.slots.every(s=>!s.active&&!s.gate));
edit(e,5+13,65); // Nonzero L4 reaches its target and then fades out of the pool.
edit(e,5+9,99);note(e,true);audio(e);note(e,false);e.advance(3000);
assert(e.frame().polyphony.slots.every(s=>!s.active&&!s.gate));
edit(e,1,5);edit(e,2,6);edit(e,3,49);edit(e,5+5*14+9,31);
const expected=toneBytes(x,0);
assert.equal(expected.length,169);
const f=e.frame();e.input({t:'editor-save',request:1,program:99,name:'FM HYBRID',scope:f.instrument.scope,token:f.instrument.programToken,targetToken:f.editor.targets[98]});
e.advance(15000);assert.equal(e.frame().editor.save.state,'written');
const restored=boot(e.store(true));choose(restored,99);
assert.deepEqual(toneBytes(restored.ex,0).slice(80),expected.slice(80));
assert(x.waswan_favourite_action(7,1,0));edit(e,1,2);assert(x.waswan_favourite_action(7,0,0));assert.equal(e.frame().fm.bytes[1],5);
const slot=(x.sim_pattern()+1)%16;
assert(x.waswan_pattern_action(slot,1,x.sim_pattern()));e.advance(5000);
edit(e,1,4);assert(x.waswan_pattern_action(slot,0,x.sim_pattern()));e.advance(500);assert.equal(e.frame().fm.bytes[1],5);
const project=emptyProject(),track=makeTrack('midi');track.instrument={type:'analog',patch:expected};project.tracks.push(track);
const {project:disk}=await readProject(await projectBlob(project,new Map()));
stageTone(x,false,4,disk.tracks[0].instrument.patch);assert(x.waswan_daw_apply(16,x.waswan_daw_token()));assert.deepEqual(toneBytes(x,4),expected);
stageTone(x,false,4,expected.slice(0,80));assert(x.waswan_daw_apply(16,x.waswan_daw_token()));assert.equal(toneBytes(x,4).length,80);
const ctx={version:1,session:seed.toString('base64'),master:x.sim_master_current(),tempo:x.sim_tempo(),
  parts:Array.from({length:4},(_,p)=>({program:x.sim_program(p)+1,engine:x.sim_engine_patch(p),
    parameters:Array.from({length:63},(_,id)=>x.sim_param(p,id)),patch:toneBytes(x,p)}))};
const other=boot();
other.restoreStudioContext(ctx,other.ex.waswan_studio_context_token());
assert.deepEqual(toneBytes(other.ex,0),ctx.parts[0].patch);
assert(!validToneBytes([...expected.slice(0,-1),100]));
console.log('FM layer passed · 32 audible algorithms, hybrid save/recall, fixed and ratio pitch, velocity, independent filter, sustain/release, favourites, pattern and DAW');
