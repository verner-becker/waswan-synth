// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
import {MidiProfile} from '../web/midi-profile.js';
import {CONTROLS,controlTarget,displayValue} from '../web/ui-controls.js';
import {chordLabel} from '../web/ui-chords.js';
const seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
const wasm=fs.readFileSync('.local/build/waswan-256.wasm');
const fixture=(bytes=wasm)=>{const e=new Engine(bytes,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));e.advance(5000);return e;};
const e=fixture(),snapshot=()=>e.frame().instrument,scope=()=>snapshot().scope;
const set=(id,value,s=scope())=>e.input({t:'ui-control',source:'ui',id,value,scope:s});
assert.equal(CONTROLS.length,12);assert.equal(snapshot().controls.length,12);assert.equal(snapshot().name.length>0,true);assert(snapshot().bpm>0);
const hashesBefore=e.store(true);
for(const id of [0,1,2,3,4,5,6,8,9,10,11])for(const value of [40,41,0,127]){set(id,value);assert.equal(snapshot().controls[id].value,value);if(id<4)assert.equal(e.ex.waswan_knob_value(id),value);}
set(7,1023);assert.equal(e.frame().master,1023);set(7,724);assert.equal(e.frame().master,724);
set(0,40);assert.equal(snapshot().controls[0].physical,e.ex.waswan_ui_cut_hz(40));set(0,41);assert(snapshot().controls[0].physical>e.ex.waswan_ui_cut_hz(40));
for(const bad of [-1,128,NaN,Infinity,1.2]){set(0,bad);assert.equal(snapshot().controls[0].value,41);}
set(0,0,scope()+1);assert.equal(snapshot().controls[0].value,41);
const oldScope=scope();e.input({t:'enc',e:5,steps:1});e.advance(100);assert.notEqual(scope(),oldScope);const val=snapshot().controls[0].value;set(0,0,oldScope);assert.equal(snapshot().controls[0].value,val);
// UI edits do not depend on the legacy page; page changes themselves do not edit controls.
e.input({t:'btn',b:13,down:true});e.advance(80);e.input({t:'btn',b:13,down:false});e.advance(100);set(0,42);assert.equal(snapshot().controls[0].value,42);
// Existing profiles migrate unchanged; new semantic assignments are opt-in, persistent and page independent.
let saved=JSON.stringify({version:1,enabled:true,bindings:[{port:'test',channel:0,cc:20,target:'enc:0',mode:'absolute'}]});
const storage={getItem:()=>saved,setItem:(_,v)=>{saved=v;}};const profile=new MidiProfile(storage);assert.equal(profile.bindings[0].target,'enc:0');assert.equal(profile.bindings[0].behavior,'normal');
assert(profile.learn(controlTarget(0),'absolute','fine'));profile.handle([0xb0,21,53],'test',m=>e.input(m));profile.controlScope=scope();
const cc=v=>profile.handle([0xb0,21,v],'test',m=>e.input(m));cc(100);assert.equal(snapshot().controls[0].value,42);cc(42);cc(43);assert.equal(snapshot().controls[0].value,43);cc(127);assert.equal(snapshot().controls[0].value,127);cc(0);assert.equal(snapshot().controls[0].value,0);
assert.equal(new MidiProfile(storage).bindings.length,2);assert.equal(new MidiProfile(storage).bindings[1].target,controlTarget(0));
profile.reset();profile.controlScope=scope();cc(90);assert.equal(snapshot().controls[0].value,0);cc(0);cc(1);assert.equal(snapshot().controls[0].value,1);
set(0,40);cc(2);assert.equal(snapshot().controls[0].value,40);cc(40);cc(41);assert.equal(snapshot().controls[0].value,41);
for(const [mode,up,down] of [['offset',65,63],['twos',1,127]]){profile.learn(controlTarget(0),mode,'fine');profile.handle([0xb0,21,0],'test',()=>{});profile.controlScope=scope();set(0,40);cc(up);assert.equal(snapshot().controls[0].value,41);cc(down);assert.equal(snapshot().controls[0].value,40);}
assert.equal(chordLabel([57,60,64,67]).name,'Am7');assert.equal(chordLabel([60,64,67]).name,'C');assert.equal(chordLabel([60,64,68]).name,'Ambiguous');assert.equal(chordLabel([]).name,'—');assert.equal(chordLabel([60,62,66]).name,'Note set');assert.equal(displayValue(0,40,1000),'1.00 kHz');
const selected=e.frame().track;e.input({t:'drums',part:selected,kit:0});e.advance(100);assert(snapshot().controls.slice(0,4).every(c=>!c.available));const drumValue=snapshot().controls[0].value;set(0,drumValue===0?1:0);assert.equal(snapshot().controls[0].value,drumValue);assert(snapshot().controls[8].available);
const otherLevels=snapshot().controls.slice(8).map(c=>c.value);set(9,33);assert.equal(snapshot().controls[9].value,33);assert.equal(snapshot().controls[8].value,otherLevels[0]);assert.equal(snapshot().controls[10].value,otherLevels[2]);
// Read-only snapshots + added host exports must produce bit-identical audio to the audited artifact.
const before=fs.existsSync('.local/validation/ui-foundation/reference-256.wasm')?'.local/validation/ui-foundation/reference-256.wasm':'.local/validation/ui-foundation/before-256.wasm';assert(fs.existsSync(before),'Run sh tests/build-ui-reference.sh; see documentation.');
const old=fixture(fs.readFileSync(before)),fresh=fixture();
for(const f of [old,fresh]){f.input({t:'voice-mode',part:0,mode:0});for(const n of [48,52,55,59])f.input({t:'midi',st:0x90,d1:n,d2:100});}
let scalarSamples=0;
for(let block=0;block<1000;block++){
  if(block===250)for(const f of [old,fresh])f.input({t:'voice-sustain',enabled:true});
  if(block===300)for(const f of [old,fresh])for(const n of [48,52,55,59])f.input({t:'midi',st:0x80,d1:n,d2:0});
  if(block===500)for(const f of [old,fresh])f.input({t:'voice-sustain',enabled:false});
  for(const f of [old,fresh]){f.render(128);f.frame();}
  for(const channel of ['sim_out_l','sim_out_r']){const samples=f=>new Float32Array(f.ex.memory.buffer,f.ex[channel](),128);assert.deepEqual(samples(fresh),samples(old));scalarSamples+=128;}
}
assert.deepEqual(fresh.store(true),old.store(true),'reading the UI state does not mutate stored session');
// Explicit edits still use existing storage shape.
assert.equal(e.store(true).byteLength,hashesBefore.byteLength);
const report={result:'PASS',hostControls:12,scopeGuard:true,legacyProfilePreserved:true,semanticPickup:true,relativeUnitSteps:true,audioScalarSamples:scalarSamples,audio:'bit-identical to pre-UI 7dc36c8 artifact',sessionShapePreserved:true,chords:'exact pitch-class templates only'};
fs.writeFileSync('.local/validation/ui-foundation/native.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
