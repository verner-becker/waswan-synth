// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
const wasm=fs.readFileSync('.local/build/waswan-256.wasm'),seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
const fixture=()=>{const e=new Engine(wasm,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));e.advance(5000);return e;};
const snapshot=e=>{const x=e.ex;return {version:1,tempo:x.sim_tempo(),master:x.sim_master_current(),session:seed.toString('base64'),
  mixer:Array.from({length:4},(_,p)=>Array.from({length:8},(_,f)=>x.waswan_studio_mix_value(p,f))),
  parts:Array.from({length:4},(_,p)=>({program:x.sim_program(p)+1,engine:x.sim_engine_patch(p),parameters:Array.from({length:63},(_,i)=>x.sim_param(p,i)),patch:Array.from({length:80},(_,i)=>x.waswan_studio_patch(p,i))}))};};
const e=fixture(),x=e.ex,original=snapshot(e),programTokens=Array.from({length:99},(_,i)=>x.waswan_editor_slot_token(i));
const stale=x.waswan_studio_context_token();e.input({t:'ui-control',source:'ui',id:0,value:40,scope:x.waswan_ui_scope()});
assert.throws(()=>e.restoreStudioContext(original,stale));assert.equal(x.sim_param(0,12),40);
const current=x.waswan_studio_context_token();assert(e.restoreStudioContext(original,current));assert.deepEqual(snapshot(e).parts,original.parts);
assert.deepEqual(Array.from({length:99},(_,i)=>x.waswan_editor_slot_token(i)),programTokens,'applying context never saves preset slots');
const bad=structuredClone(original);bad.parts[3].parameters[0]=255;bad.parts[3].patch[0]=255;
assert.throws(()=>e.restoreStudioContext(bad,x.waswan_studio_context_token()));assert.deepEqual(snapshot(e).parts,original.parts,'invalid part rejected before changing any other part');
const before=snapshot(e).mixer;x.waswan_studio_mix_set(1,0,55);x.waswan_studio_mix_set(1,1,-31);assert.equal(x.waswan_studio_mix_value(1,0),55);assert.equal(x.waswan_studio_mix_value(1,1),-31);assert.equal(x.waswan_ui_value(9),55);
for(const p of [0,2,3])assert.deepEqual(snapshot(e).mixer[p],before[p]);
assert(!x.waswan_studio_mix_set(4,0,100));assert(!x.waswan_studio_mix_set(1,1,65));assert(!x.waswan_studio_mix_set(1,0,128));
e.input({t:'drums',part:1,kit:0});e.advance(200);const drum=snapshot(e);assert.equal(drum.parts[1].engine,2);assert(e.restoreStudioContext(drum,x.waswan_studio_context_token()));e.advance(100);
assert.deepEqual(snapshot(e).parts[1].patch,drum.parts[1].patch);
console.log('PASS Studio context: complete patch restore, stale-token and atomic validation guards, unchanged preset slots, independent mixer and DRUM-X roundtrip');
