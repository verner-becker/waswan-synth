// SPDX-License-Identifier: GPL-3.0-only
// Architectural probes for the pinned baseline, not a Studio implementation contract.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';

const root='.local/validation/studio-wave-0';fs.mkdirSync(root,{recursive:true});
const wasm=fs.readFileSync('.local/build/waswan-256.wasm');
const seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
const fixture=(store=seed)=>{
  const e=new Engine(wasm,store.buffer.slice(store.byteOffset,store.byteOffset+store.byteLength));
  e.advance(5000);e.input({t:'voice-mode',part:0,mode:0});e.advance(50);return e;
};
const e=fixture(),before=e.frame();
assert.equal(e.ex.sim_rate(),44100);
assert.equal(e.ex.waswan_internal_frames(),256);
assert.equal(e.ex.waswan_midi_event_limit(),1024);
assert.equal(e.ex.sim_blob_count(),21);
assert.equal(e.ex.sim_blob_size(),16384);
const ms=e.ex.sim_ms();
for(let n=44100;n>0;){const frames=Math.min(128,n);e.render(frames);n-=frames;}
assert.equal(e.ex.sim_ms()-ms,1000,'firmware clock follows rendered sample count');

// Current Engine ignores future scheduling metadata: receipt immediately queues input.
e.input({t:'midi',st:0x90,d1:60,d2:100,timeStamp:1e9,frame:1e9});
e.render(1024);
assert(e.frame().polyphony.slots.some(v=>v.gate&&v.note===60));
e.input({t:'midi',st:0x80,d1:60,d2:0});e.render(1024);
assert(e.frame().polyphony.slots.every(v=>!v.gate));

// Compare persisted blobs and live unsaved tone edits; a force flush is not Save.
const live=fixture(),original=live.frame().instrument.controls[0].value;
const changed=original===40?41:40;
live.input({t:'ui-control',source:'ui',id:0,value:changed,scope:live.frame().instrument.scope});
assert.equal(live.frame().instrument.controls[0].value,changed);
const store=new Uint8Array(live.store(true)),restored=fixture(store);
const recovered=restored.frame().instrument.controls[0].value;
assert.equal(recovered,original,'persisted session does not preserve unsaved live cutoff');

// Events delivered together can start and end before any observable voice is allocated.
const short=fixture();
short.input({t:'midi',st:0x90,d1:60,d2:100});
short.input({t:'midi',st:0x80,d1:60,d2:0});
short.render(1024);
const shortSlots=short.frame().polyphony.slots.filter(v=>v.active&&v.note===60).length;
const report={result:'PASS',sampleRate:44100,internalFrames:256,controlFrames:16,
  parts:before.polyphony.parts.length,voiceCapacity:before.polyphony.limit,midiQueueCapacity:1024,
  persistedBytes:store.byteLength,firmwareMsPer44100Frames:1000,futureMetadataIgnored:true,
  unsavedTone:{original,changed,recovered,preserved:false},shortNoteActiveSlotsAtSnapshot:shortSlots,
  limitations:'Architecture probes; no real-time MIDI latency or recording alignment measurement'};
fs.writeFileSync(`${root}/inventory.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
