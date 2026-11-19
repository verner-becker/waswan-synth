// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {decodeDx7} from '../scripts/import-dx7.mjs';
import {readToneFile} from '../web/tone-bank.js';
import {Engine} from '../.local/www/simulator/engine.js';

const source = 'assets/dx7/aquanode-presets-1.syx';
const library = 'banks/DX7 - Aquanode';
const syx = await readFile(source);
assert.equal(createHash('sha256').update(syx).digest('hex'),
  'b1ce630d7f6e8c4eec89f59fdb46fd0b623990fa0b97efe31f75dbfa7389b5f0');
const tones = decodeDx7(syx);
assert.equal(tones.length, 32);

function dump(payload, format) {
  const checksum = -payload.reduce((a, b) => a + b, 0) & 127;
  return Buffer.from([0xf0,0x43,15,format,payload.length >> 7,payload.length & 127,...payload,checksum,0xf7]);
}
// Distinct sentinel fields for OP1 and OP6 catch a reversed order or bit shift.
const vced = Buffer.alloc(155), vmem = Buffer.alloc(4096);
for (const [index, level] of [[0,52],[5,98]]) {
  vced.set([99,88,77,66,55,44,33,22,39,12,14,3,1,5,3,6,level,1,29,76,13], index * 21);
  vmem.set([99,88,77,66,55,44,33,22,39,12,14,7,109,27,level,59,76], index * 17);
}
vced.set([31,7,1], 134);
vmem.set([31,15], 110);
const name = Buffer.from('FM/TEST   ');
vced.set(name,145);
vmem.set(name,118);
const [single] = decodeDx7(dump(vced,0));
assert.deepEqual(decodeDx7(dump(vmem,9))[0], single);
assert.deepEqual(single.patch.slice(80,99), [241,31,7,0,127,1,29,76,13,98,6,99,88,77,66,55,44,33,22]);
assert.equal(single.patch[85+5*14+4], 52);
assert.equal(single.name, 'FM/TEST');

for (const offset of [0,1,2,3,4,5,7,4102,4103]) {
  const bad = Buffer.from(syx);
  bad[offset] ^= 64;
  assert.throws(() => decodeDx7(bad));
}
assert.throws(() => decodeDx7(syx.subarray(1)));
vmem[0] = 100;
assert.throws(() => decodeDx7(dump(vmem,9)), /slot 1/);
vmem[0] = 128;
assert.throws(() => decodeDx7(dump(vmem,9)), /7-bit/);

const temp = await mkdtemp(path.join(tmpdir(), 'waswan-dx7-'));
try {
  const destination = path.join(temp, 'Bank');
  const run = input => spawnSync(process.execPath, ['scripts/import-dx7.mjs',input,destination]);
  const corrupt = path.join(temp,'bad.syx');
  await writeFile(corrupt, syx.subarray(0,-1));
  assert.notEqual(run(corrupt).status, 0);
  assert.deepEqual(await readdir(temp), ['bad.syx']);
  assert.equal(run(source).status, 0);
  assert.notEqual(run(source).status, 0, 'must preserve an existing bank');
  const files = (await readdir(destination)).sort();
  assert.deepEqual(files, (await readdir(library)).sort());
  assert.equal(files.length, tones.length);
  const wasm = await readFile('.local/build/waswan-256.wasm');
  const seed = await readFile('upstream/SMKSYNTH/web/simulator/factory-session.bin');
  for (const [i, file] of files.entries()) {
    const bytes = await readFile(path.join(library,file));
    assert.deepEqual(await readFile(path.join(destination,file)), bytes);
    const tone = await readToneFile(new Blob([bytes]));
    assert.deepEqual(tone, tones[i]);
    const engine = new Engine(wasm,seed);
    engine.advance(1000);
    const x = engine.ex;
    engine.input({t:'tone-bank-load',request:1,scope:x.waswan_ui_scope()>>>0,
      token:x.waswan_program_token()>>>0,discard:true,patch:tone.patch});
    assert.equal(engine.toneBankResult.loaded,true,engine.toneBankResult.error);
    assert.deepEqual(engine.frame().fm.bytes, tone.patch.slice(80));
    x.waswan_daw_taps(1);
    engine.input({t:'midi',st:144,d1:60,d2:100});
    let peak = 0;
    // Include key-up: Sweep's carrier has silent L1–L3 and a nonzero L4.
    for (let block = 0; block < 2400 && peak <= 0.0001; block++) {
      if (block === 1600) engine.input({t:'midi',st:128,d1:60,d2:0});
      engine.render(128);
      const samples = new Float32Array(x.memory.buffer,x.waswan_daw_output(0,0),128);
      peak = Math.max(peak,...samples.map(Math.abs));
    }
    assert(Number.isFinite(peak) && peak > 0.0001, file + ' dry audio');
  }
} finally {
  await rm(temp, {recursive:true,force:true});
}
console.log('DX7 import passed · single and bulk dumps, operator mapping, malformed input, reproducible files, 32 playable programs');
