// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {preparePair,scanTapeFolder} from '../../web/mellotron-library.js';
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
const solo=await preparePair(folder(['60.wav']),['A','A']);
assert.equal(solo.regions.length,1);
const hash=data=>createHash('sha256').update(data).digest('hex');
const sampleHash=hash(bytes.subarray(44));
assert.equal(solo.id,hash(JSON.stringify([[0,'A',60,sampleHash],[1,'A',60,sampleHash]])),'Existing two-bank preset ID');
const choir={name:'CHOIR',async *values(){yield file('60 CHOIR.WAV');}};
assert.deepEqual(await scanTapeFolder(choir),{names:['CHOIR'],direct:true});
const fromLeaf=await preparePair(choir,['CHOIR','CHOIR'],true);
const fromLibrary=await preparePair(folder(['60 CHOIR.WAV']),['CHOIR','CHOIR']);
assert.equal(fromLeaf.id,fromLibrary.id);
assert.deepEqual(await scanTapeFolder({async *values(){yield file('README.txt');}}),{names:[],direct:false});
await assert.rejects(preparePair(folder(['60.wav','60-high.wav']),['A','B']),/Duplicate/);
await assert.rejects(preparePair(folder(['128.wav']),['A','B']),/MIDI root/);
await assert.rejects(preparePair(folder([]),['A','B']),/No WAVs/);
await assert.rejects(preparePair(folder(Array.from({length:49},(_,i)=>i+'.wav')),['A','B']),/48 regions/);
for(const [at,value] of [[22,2],[24,48000],[4,22],[40,1]]){
  const invalid=Buffer.from(bytes);invalid.writeUInt16LE(value,at);
  await assert.rejects(readSample(new Blob([invalid]),60));
}
console.log('PASS tape folders, WAV checks, root mapping, pair identity and region limits');
