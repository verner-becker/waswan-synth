// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--input-type=module','-e',`
import fs from 'node:fs';import assert from 'node:assert/strict';
import {Engine} from './.local/www/simulator/engine.js';
const w=fs.readFileSync('.local/validation/daw-mvp-wave-3/fault.wasm'),s=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
const e=new Engine(w,s.buffer.slice(s.byteOffset,s.byteOffset+s.byteLength));e.advance(5000);e.input({t:'voice-mode',part:0,mode:0});e.advance(50);
for(const p of [255,7,0])e.ex.waswan_test_queue(p);e.advance(100);
assert(e.frame().polyphony.slots.some(v=>v.gate&&v.part===0&&v.note===62));
assert(!e.frame().polyphony.slots.some(v=>v.gate&&v.part===7));
console.log('PASS');
`],{timeout:5000,encoding:'utf8'});
assert.equal(result.error,undefined,'malformed queue must not hang the DSP');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS/);
console.log('PASS DAW fault injection: invalid/inactive queue entries are consumed; subsequent valid notes render without hanging');
