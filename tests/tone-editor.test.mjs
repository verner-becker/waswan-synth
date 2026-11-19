// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
const root='.local/validation/tone-editor-v1',seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
fs.mkdirSync(root,{recursive:true});
const fixture=(path='.local/build/waswan-256.wasm',store=seed)=>{const e=new Engine(fs.readFileSync(path),store.buffer.slice(store.byteOffset,store.byteOffset+store.byteLength));e.advance(5000);return e;};
let request=0;
const edit=(e,id,value,scope=e.frame().instrument.scope)=>{e.input({t:'editor-set',id,value,scope});return e.frame().editor.edit;};
const choose=(e,program)=>{const f=e.frame();e.input({t:'program-select',request:++request,program,scope:f.instrument.scope,token:f.instrument.programToken,discard:true});e.advance(150);};
const save=(e,program,name,extra={})=>{const f=e.frame();e.input({t:'editor-save',request:++request,program,name,scope:f.instrument.scope,token:f.instrument.programToken,targetToken:f.editor.targets[program-1],...extra});return e.frame().editor.save;};
const e=fixture(),first=e.frame(),catalog=first.editorCatalog;
assert.equal(catalog.length,73);assert.equal(new Set(catalog.map(p=>p.id)).size,73);assert.equal(first.editor.targets.length,99);assert.equal(e.frame().editorCatalog,undefined);
for(let part=0;part<4;part++){
  if(part){e.input({t:'enc',e:5,steps:1});e.advance(150);}choose(e,71);
  for(const p of catalog){
    for(const value of [p.min,p.max]){assert(edit(e,p.id,value).applied,`part ${part} param ${p.id} value ${value}`);assert.equal(p.id<63?e.ex.sim_param(p.shared?0:part,p.id):e.ex.waswan_editor_value(p.id),value);}
    if(p.id===0)edit(e,0,1); // avoid SUPER bypass while testing other oscillator parameters
  }
  const f=e.frame();assert.equal(f.track,part);assert(f.instrument.edited);
  assert.equal(edit(e,12,40,f.instrument.scope^1).applied,false);
  assert.equal(edit(e,12,-1).applied,false);assert.equal(edit(e,12,128).applied,false);
  assert(edit(e,0,4).applied);assert.equal(edit(e,9,64).applied,false);assert.equal(edit(e,8,1).applied,false);assert(edit(e,0,1).applied);
}
assert(edit(e,29,0).applied);assert.equal(e.frame().editor.values[29].display,'0.05Hz');
// Restore clean source, retain a held note through edit and save; no host panic/reinitialization.
const s=fixture();choose(s,71);edit(s,27,0);edit(s,12,40);edit(s,1,64);
s.input({t:'midi',st:0x90,d1:60,d2:100});s.advance(100);assert(s.frame().polyphony.slots.some(v=>v.gate));
const before=s.frame().instrument;edit(s,12,41);
assert.equal(save(s,99,'TEST TONE',{token:before.programToken}).applied,false);
assert.equal(save(s,99,'TEST TONE',{targetToken:0}).applied,false);
const encoder=globalThis.TextEncoder;try{globalThis.TextEncoder=undefined;assert(save(s,99,'TEST TONE').applied);}finally{globalThis.TextEncoder=encoder;}assert.equal(s.frame().programs[0],99);assert.equal(s.frame().instrument.name,'TEST TONE');assert(!s.frame().instrument.edited);
s.advance(3000);assert.equal(s.frame().editor.save.state,'waiting');assert(s.frame().polyphony.slots.some(v=>v.gate));
s.input({t:'midi',st:0x80,d1:60,d2:0});s.advance(15000);assert.equal(s.frame().editor.save.state,'written');assert(!s.frame().polyphony.slots.some(v=>v.gate));
const stored=Buffer.from(s.store(true)),r=fixture(undefined,stored);choose(r,99);assert.equal(r.frame().instrument.name,'TEST TONE');assert.equal(r.ex.sim_param(0,12),41);assert.equal(stored.length,21*16384);
// Save overwrites the same slot, and clean parts using that slot track the original propagation rule.
r.input({t:'enc',e:5,steps:1});r.advance(150);choose(r,99);edit(r,12,42);save(r,99,'TEST TONE');r.advance(15000);assert.equal(r.frame().editor.save.state,'written');assert.equal(r.ex.sim_param(0,12),42);assert.equal(r.ex.sim_param(1,12),42);
r.input({t:'enc',e:5,steps:-1});r.advance(150);edit(r,12,43);r.input({t:'enc',e:5,steps:1});r.advance(150);edit(r,12,44);save(r,99,'TEST TONE');r.advance(15000);assert.equal(r.ex.sim_param(0,12),43,'edited peer part is preserved');
const drum=fixture();drum.input({t:'drums',part:0,kit:0});drum.advance(200);const drumFirst=drum.frame();assert.equal(drumFirst.editorCatalog[4].options.filter(Boolean).length,10,'ANALOG catalog is stable when bootstrapped on DRUM-X');assert(!drumFirst.editor.available);assert.equal(edit(drum,12,40).applied,false);assert.equal(save(drum,99,'NO DRUM').applied,false);
// Snapshots/metadata alone do not alter audio or the stored session.
const old=fixture(`${root}/before-256.wasm`),fresh=fixture();
for(const a of [old,fresh]){a.input({t:'voice-mode',part:0,mode:0});for(const n of [48,52,55,59])a.input({t:'midi',st:0x90,d1:n,d2:100});}
let samples=0;for(let block=0;block<1000;block++){
  if(block===250)for(const a of [old,fresh])a.input({t:'voice-sustain',enabled:true});
  if(block===300)for(const a of [old,fresh])for(const n of [48,52,55,59])a.input({t:'midi',st:0x80,d1:n,d2:0});
  if(block===500)for(const a of [old,fresh])a.input({t:'voice-sustain',enabled:false});
  for(const a of [old,fresh]){a.render(128);a.frame();}
  for(const channel of ['sim_out_l','sim_out_r']){assert.deepEqual(new Float32Array(old.ex.memory.buffer,old.ex[channel](),128),new Float32Array(fresh.ex.memory.buffer,fresh.ex[channel](),128));samples+=128;}
}
assert.deepEqual(fresh.store(true),old.store(true));
const report={result:'PASS',parameters:73,parts:4,bounds:true,superBypass:true,staleGuards:true,saveAs:true,overwrite:true,cleanPeerPropagation:true,editedPeerPreserved:true,restore:true,drumBlocked:true,heldNoteAcrossSave:true,audioScalarSamples:samples,sessionUnchangedWithoutEdits:true};
fs.writeFileSync(`${root}/native.json`,JSON.stringify(report,null,2));console.log(report);
