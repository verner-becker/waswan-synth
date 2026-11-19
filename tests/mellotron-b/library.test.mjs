// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {preparePair} from '../../web/mellotron-library.js';
import {readSample} from '../../web/mellotron-wav.js';
import {writeFixture} from '../mellotron-a/fixture.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const bytes=writeFixture();
const file=name=>({kind:'file',name,async getFile(){return new Blob([bytes]);}});
const folder=(names)=>({async getDirectoryHandle(name){return {name,async *values(){for(const n of names)yield file(n);}};}});
const pair=await preparePair(folder(['72 high.wav','60.wav']),['A','B']);
assert.deepEqual(pair.regions.map(r=>[r.bank,r.root]),[[0,60],[0,72],[1,60],[1,72]]);
assert.equal((await preparePair(folder(['60.wav','72 high.wav']),['A','B'])).id,pair.id);
assert.notEqual((await preparePair(folder(['60.wav','72 high.wav']),['B','A'])).id,pair.id);
await assert.rejects(preparePair(folder(['60.wav','60-high.wav']),['A','B']),/Duplicate/);
await assert.rejects(preparePair(folder(['128.wav']),['A','B']),/MIDI root/);
await assert.rejects(preparePair(folder([]),['A','B']),/No WAVs/);
await assert.rejects(preparePair(folder(Array.from({length:49},(_,i)=>i+'.wav')),['A','B']),/48 regions/);
for(const [at,value] of [[22,2],[24,48000],[4,22],[40,1]]){
  const invalid=Buffer.from(bytes);invalid.writeUInt16LE(value,at);
  await assert.rejects(readSample(new Blob([invalid]),60));
}
console.log('PASS tape folders, WAV checks, root mapping, pair identity and region limits');
