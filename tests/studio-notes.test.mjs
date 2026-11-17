// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
const path=process.env.STUDIO_WASM||'.local/build/waswan-256.wasm',wasm=fs.readFileSync(path),seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
const fixture=()=>{const e=new Engine(wasm,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));e.advance(5000);e.input({t:'voice-mode',part:0,mode:0});e.advance(50);return e;};
const e=fixture(),owned=engine=>engine.frame().polyphony.slots.filter((v,i)=>v.gate&&engine.ex.waswan_studio_owned(i)),live=engine=>engine.frame().polyphony.slots.filter((v,i)=>v.gate&&!engine.ex.waswan_studio_owned(i));
e.input({t:'midi',st:144,d1:60,d2:100});e.advance(50);assert.equal(live(e).length,1);
assert(e.ex.waswan_studio_note(0,60,90));e.render(512);assert.equal(owned(e).length,1);assert.equal(live(e).length,1);
assert(e.ex.waswan_studio_note(0,60,0));e.render(512);assert.equal(owned(e).length,0);assert.equal(live(e).length,1,'same-pitch physical note survives sequencer release');
assert(!e.ex.waswan_studio_note(4,60,100));assert(!e.ex.waswan_studio_note(0,128,100));assert(!e.ex.waswan_studio_note(0,60,128));
for(let part=0;part<4;part++){assert(e.ex.waswan_studio_note(part,64,80));e.render(512);assert(owned(e).some(v=>v.part===part));assert(e.ex.waswan_studio_note(part,64,0));}
// MONO/UNISON must return to a held physical pitch rather than strand/release it.
for(const mode of [2,3]){
  const m=fixture();m.input({t:'voice-mode',part:0,mode});m.advance(50);m.input({t:'midi',st:144,d1:60,d2:100});m.advance(50);
  m.ex.waswan_studio_note(0,64,100);m.render(512);assert(owned(m).some(v=>v.note===64));
  m.ex.waswan_studio_note(0,64,0);m.render(512);assert.equal(owned(m).length,0);assert(live(m).some(v=>v.note===60));
}
console.log('PASS Studio host notes: four parts, same-pitch ownership, MONO/UNISON live return and invalid input guards');
