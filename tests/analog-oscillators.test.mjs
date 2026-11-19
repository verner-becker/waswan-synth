// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
import {projectBlob,readProject} from '../web/daw-format.js';
import {emptyProject,makeTrack} from '../web/daw-project.js';

const seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
const current='.local/build/waswan-256.wasm';
function boot(path=current){
  const engine=new Engine(fs.readFileSync(path),seed);
  engine.advance(5000);
  return engine;
}
function set(engine,id,value){
  assert.equal(engine.ex.waswan_editor_set(id,value,engine.ex.waswan_ui_scope()),1,`edit ${id} to ${value}`);
}
function play(engine,on){
  for(const note of [52,60,67])engine.input({t:'midi',st:on?144:128,d1:note,d2:on?92:0});
}
function samples(engine,channel='sim_out_l'){
  return new Float32Array(engine.ex.memory.buffer,engine.ex[channel](),128);
}
const reference=process.env.ANALOG_REFERENCE || '.local/build/waswan-128.wasm';
let compared=0;
for(const [osc1,osc2,sync,fm,pwm] of [[0,1,0,0,0],[1,2,1,0,90],[2,3,0,63,127],[3,1,1,32,32],[4,2,0,0,0]]){
  const a=boot(reference),b=boot();
  for(const e of [a,b]){
    for(const [p,v] of [[38,0],[8,sync],[9,fm],[33,pwm],[4,osc2],[0,osc1]])set(e,p,v);
    if(osc1===4)assert(e.ex.waswan_super_set(0,1,29));
    play(e,true);
  }
  for(let block=0;block<160;block++){
    if(block===100)for(const e of [a,b])play(e,false);
    for(const e of [a,b])e.render(128);
    for(const channel of ['sim_out_l','sim_out_r']){
      assert.deepEqual(samples(b,channel),samples(a,channel));
      compared+=128;
    }
  }
}

// Isolate each source. Every offered shape must produce a distinct audible signal.
for(const id of [0,4,63,66]){
  const hashes=new Set();
  const waves=id===0?[1,2,3,4,5,6,7,8,9,10]:id===4?[1,2,3,5,6,7,8,9,10]:[1,2,3,4,5,6,7,8];
  for(const wave of waves){
    const e=boot();
    for(const [p,v] of [[0,0],[4,0],[3,0],[12,120],[1,40],[5,40],[2,100],[6,100],[id,wave]])set(e,p,v);
    if(wave===8 && id>=63)set(e,id===63?70:72,41);
    play(e,true);
    e.render(1024);
    let hash=2166136261,peak=0;
    for(let block=0;block<12;block++){
      e.render(128);
      for(const sample of samples(e)){
        assert(Number.isFinite(sample));
        peak=Math.max(peak,Math.abs(sample));
        hash=Math.imul(hash^Math.round(sample*1e7),16777619);
      }
    }
    assert(peak>0.0001,`inaudible ${id}/${wave}`);
    assert(!hashes.has(hash),`duplicate shape ${id}/${wave}`);
    hashes.add(hash);
  }
}
// Pulse width changes the rendered signal for both sources at the same pitch and gain.
for(const [waveId,widthId] of [[63,70],[66,72]]){
  const signals=[12,64,104].map(width=>{
    const e=boot();
    for(const [id,value] of [[0,0],[4,0],[3,0],[waveId,8],[widthId,width]])set(e,id,value);
    play(e,true);e.render(1024);e.render(128);
    return Array.from(samples(e));
  });
  for(const [a,b] of [[0,1],[1,2],[0,2]])assert.notDeepEqual(signals[a],signals[b]);
}
// One octave up should double the frequency even while the note stays held.
for(const waveId of [63,66]){
  const tone=boot();
  for(const [p,v] of [[0,0],[4,0],[3,0],[42,0],[12,127],[54,0],[58,0],[62,0],[waveId,7]])set(tone,p,v);
  tone.input({t:'midi',st:144,d1:69,d2:100});
  const crossings=[];
  for(const pitch of [15,27]){
    set(tone,waveId+2,pitch);tone.advance(500);
    let last=0,count=0;
    for(let block=0;block<180;block++){
      tone.render(128);
      for(const sample of samples(tone)){if(last<0&&sample>=0)count++;last=sample;}
    }
    crossings.push(count);
  }
  assert(crossings[0]>50 && Math.abs(crossings[1]-2*crossings[0])<=3,`octave ${crossings}`);
}
// Check the full fine span against OSC2's Q8 semitone scale on each extra source.
for(const [waveId,fineId] of [[63,69],[66,71]]){
  const tone=boot();
  for(const [id,value] of [[0,0],[4,0],[3,0],[42,0],[12,127],[54,0],[58,0],[62,0],[waveId,7]])set(tone,id,value);
  tone.input({t:'midi',st:144,d1:81,d2:100});
  const cycles=[];
  for(const raw of [0,64,127]){
    set(tone,fineId,raw);tone.advance(200);
    let last=0,count=0;
    for(let block=0;block<512;block++){
      tone.render(128);
      for(const sample of samples(tone)){if(last<0&&sample>=0)count++;last=sample;}
    }
    cycles.push(count);
  }
  for(const [index,steps] of [[0,-64],[2,63]])
    assert(Math.abs(cycles[index]-cycles[1]*2**(steps*2/256/12))<3,`fine tuning ${cycles}`);
}
if(process.env.OSC_BANK_REFERENCE){
  for(let wave=1;wave<=7;wave++){
    const old=boot(process.env.OSC_BANK_REFERENCE),fresh=boot();
    for(const synth of [old,fresh]){
      set(synth,63,wave);set(synth,66,8-wave);set(synth,65,7);set(synth,68,28);play(synth,true);
    }
    for(let i=0;i<80;i++){
      old.render(128);fresh.render(128);
      for(const channel of ['sim_out_l','sim_out_r'])assert.deepEqual(samples(old,channel),samples(fresh,channel));
    }
  }
}
const e=boot(),x=e.ex;
set(e,0,4);assert(x.waswan_super_set(0,1,37));
for(const [id,value] of [[63,7],[64,17],[65,3],[66,3],[67,28],[68,27]])set(e,id,value);
assert.equal(x.waswan_super_value(0,1),37);
assert(x.waswan_super_set(0,1,81));
assert.deepEqual(Array.from({length:6},(_,i)=>x.waswan_editor_value(63+i)),[7,17,3,3,28,27]);
set(e,0,10);set(e,4,6);
for(const [id,value] of [[63,8],[66,8],[69,21],[70,9],[71,118],[72,105],[8,1],[31,2],[36,1],[37,2],[38,1]])set(e,id,value);
const patch=Array.from({length:80},(_,i)=>x.waswan_daw_patch(0,i));
const project=emptyProject(),track=makeTrack('midi');
track.instrument={type:'analog',patch};project.tracks.push(track);
const {project:reopened}=await readProject(await projectBlob(project,new Map()));
const restored=boot(),y=restored.ex;
new Uint8Array(y.memory.buffer,y.waswan_daw_stage_buffer(),80).set(reopened.tracks[0].instrument.patch);
assert.equal(y.waswan_daw_apply(1,y.waswan_daw_token()),1);
assert.deepEqual(Array.from({length:80},(_,i)=>y.waswan_daw_patch(0,i)),patch);
assert.deepEqual(Array.from({length:6},(_,i)=>y.waswan_editor_value(63+i)),[8,17,3,8,28,27]);
assert.deepEqual([69,70,71,72].map(id=>y.waswan_editor_value(id)),[21,9,118,105]);
assert.deepEqual([8,31,36,37,38].map(id=>y.sim_param(0,id)),[1,2,1,2,1]);
for(const [wave,width] of [[63,70],[66,72]]){
  const held=y.waswan_editor_value(width);
  set(restored,wave,4);
  assert.equal(y.waswan_editor_set(width,0,y.waswan_ui_scope()),0);
  set(restored,wave,8);
  assert.equal(y.waswan_editor_value(width),held);
}
const ids=[63,66,69,70,71,72],saved=ids.map(id=>y.waswan_editor_value(id));
assert(y.waswan_favourite_action(7,1,0));
set(restored,69,64);set(restored,72,0);
assert(y.waswan_favourite_action(7,0,0));
assert.deepEqual(ids.map(id=>y.waswan_editor_value(id)),saved);
const slot=(y.sim_pattern()+1)%16;
assert(y.waswan_pattern_action(slot,1,y.sim_pattern()));restored.advance(5000);
set(restored,69,64);set(restored,72,0);
assert(y.waswan_pattern_action(slot,0,y.sim_pattern()));restored.advance(500);
assert.deepEqual(ids.map(id=>y.waswan_editor_value(id)),saved);
console.log({result:'PASS',legacyStereoSamples:compared,isolatedShapes:35,projectRoundTrip:true,superMix:true});
