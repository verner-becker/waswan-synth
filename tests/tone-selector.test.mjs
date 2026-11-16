// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
const root='.local/validation/tone-selector-v1';fs.mkdirSync(root,{recursive:true});
const seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
const fixture=(path='.local/build/waswan-256.wasm',store=seed)=>{const e=new Engine(fs.readFileSync(path),store.buffer.slice(store.byteOffset,store.byteOffset+store.byteLength));e.advance(5000);return e;};
let request=0;
const choose=(e,program,discard=false,override={})=>{const f=e.frame();e.input({t:'program-select',request:++request,program,scope:f.instrument.scope,token:f.instrument.programToken,discard,...override});return e.frame().programSelection;};
const e=fixture(),first=e.frame(),library=first.programLibrary;
assert.equal(library.length,99);assert.deepEqual(library.map(p=>p.number),Array.from({length:99},(_,i)=>i+1));
for(const p of library){const name=String.fromCharCode(...Array.from({length:10},(_,i)=>e.ex.sim_program_name(p.number-1,i))).trim();assert.equal(p.name,name);}
assert.equal(e.frame().programLibrary,undefined,'unchanged catalog is not retransmitted');
// All four parts load independently using original programs, parameters and edit flag.
for(let part=0;part<4;part++){
  if(part){e.input({t:'enc',e:5,steps:1});e.advance(150);}
  const before=e.frame(),program=part+1;
  assert(choose(e,program,true).applied);e.advance(150);const after=e.frame();
  assert.equal(after.track,part);assert.equal(after.programs[part],program);assert.equal(after.instrument.edited,false);
  for(let other=0;other<4;other++)if(other!==part)assert.equal(after.programs[other],before.programs[other]);
  assert.equal(after.instrument.name,library[program-1].name);
  const scope=after.instrument.scope;e.input({t:'ui-control',source:'ui',id:0,value:40,scope});
  assert.equal(choose(e,program+1).applied,false,'unsaved patch needs consent');assert.equal(e.frame().programs[part],program);
  const stale=e.frame().instrument;e.input({t:'ui-control',source:'ui',id:0,value:41,scope});
  assert.equal(choose(e,program+1,true,{token:stale.programToken}).applied,false,'changed patch cannot be discarded by stale consent');
  assert.equal(choose(e,program+1,true,{scope:scope^1}).applied,false);
  assert(choose(e,program+1,true).applied);assert.equal(e.frame().instrument.edited,false);
}
const savedPrograms=e.frame().programs;for(const program of [0,100,NaN,1.5])choose(e,program,true);assert.deepEqual(e.frame().programs,savedPrograms);
// Rename/save-as through original Legacy handlers; changed user names refresh the catalog.
const user=fixture();user.frame();assert(choose(user,1,true).applied);user.advance(100);
const button=(down,ms)=>{user.input({t:'btn',b:11,down});user.advance(ms);};
button(true,850);button(false,150);assert.equal(user.frame().presetSave,1);
user.input({t:'enc',e:1,steps:1});user.input({t:'enc',e:6,steps:98});user.advance(150);
button(true,90);button(false,150);assert.equal(user.frame().presetSave,6);
button(true,90);button(false,5000);
const renamed=user.frame();assert.equal(renamed.programs[0],99);assert.equal(renamed.instrument.edited,false);
assert(renamed.programLibrary,'SAVE invalidates the name catalog before/after flash writes');
assert.notEqual(renamed.instrument.name,library[98].name);assert.equal(renamed.programLibrary[98].name,renamed.instrument.name);
const stored=Buffer.from(user.store(true));assert.equal(stored.byteLength,21*16384);
const restored=fixture('.local/build/waswan-256.wasm',stored),restoredList=restored.frame().programLibrary;
assert.equal(restoredList[98].name,renamed.instrument.name);assert(choose(restored,99,true).applied);assert.equal(restored.frame().instrument.name,renamed.instrument.name);
// Adapter must match the original PRESETS encoder, including held notes and audio.
const native=fixture(),legacy=fixture();
for(const x of [native,legacy]){x.input({t:'voice-mode',part:0,mode:0});for(const n of [48,52,55])x.input({t:'midi',st:0x90,d1:n,d2:100});x.advance(100);}
const current=native.frame().programs[0],next=current===99?98:current+1;
assert(choose(native,next,true).applied);legacy.input({t:'enc',e:6,steps:next-current});
for(const x of [native,legacy])x.advance(200);
assert.equal(native.frame().programs[0],legacy.frame().programs[0]);assert.deepEqual(native.frame().instrument.controls,legacy.frame().instrument.controls);
let samples=0;for(let block=0;block<500;block++){
  if(block===200)for(const x of [native,legacy])for(const n of [48,52,55])x.input({t:'midi',st:0x80,d1:n,d2:0});
  for(const x of [native,legacy])x.render(128);
  for(const channel of ['sim_out_l','sim_out_r']){assert.deepEqual(new Float32Array(native.ex.memory.buffer,native.ex[channel](),128),new Float32Array(legacy.ex.memory.buffer,legacy.ex[channel](),128));samples+=128;}
}
// No selection: new read-only APIs preserve the approved v0.2 audio exactly.
const reference=fs.existsSync(`${root}/before-256.wasm`)?`${root}/before-256.wasm`:`${root}/reference-256.wasm`;
assert(fs.existsSync(reference),'Build the v0.2 reference as documented in docs/tone-selector-v1.md');
const old=fixture(reference),fresh=fixture();
for(const x of [old,fresh]){x.input({t:'voice-mode',part:0,mode:0});x.input({t:'midi',st:0x90,d1:60,d2:100});}
for(let block=0;block<500;block++){for(const x of [old,fresh]){x.render(128);x.frame();}for(const ch of ['sim_out_l','sim_out_r'])assert.deepEqual(new Float32Array(old.ex.memory.buffer,old.ex[ch](),128),new Float32Array(fresh.ex.memory.buffer,fresh.ex[ch](),128));}
const report={result:'PASS',programs:99,parts:4,editConsent:true,staleGuard:true,userSaveRename:true,sessionRestore:true,legacySelectionAudioSamples:samples,v02AudioSamples:128000};fs.writeFileSync(`${root}/native.json`,JSON.stringify(report,null,2));console.log(report);
