// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime} from '../../web/sampler-runtime.js';
import {diskDirectory} from './filesystem.mjs';
import {collect, importOriginal, initializeLibrary, load, prepare} from '../../web/sampler-library.js';
import {encodeSample, processWav} from '../../web/sampler-offline.js';
import {createWorking, listWorking, openWorking, prepareWorking, promoteWorking, renderWorking,
  saveWorking, updateWorking, workingFromRef, workingInstrument} from '../../web/sampler-working.js';

const dir = await mkdtemp(join(tmpdir(),'waswan-working-'));
try {
  const root = await diskDirectory(dir);
  const {id:libraryId} = await initializeLibrary(root);
  const pcm = Float32Array.from({length:48000*2}, (_,i) =>
    0.3 * Math.sin(2*Math.PI*Math.floor(i/2)*(i%2 ? 330 : 220)/48000));
  const wav = encodeSample({sampleRate:48000,channels:2,pcm});
  const source = await importOriginal(root,wav,'Samples/Originals/session.wav');
  const engine = new Engine(await readFile('.local/build/waswan-256.wasm'),
    await readFile('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
  engine.advance(4000);
  const runtime = new SamplerRuntime(engine.ex);
  const requests = [];
  let rejectChunks = false;
  const player = {requests:() => ({async request(t, payload) {
    requests.push(t);
    if (t === 'daw-sampler-patch') return {patch:new Uint8Array(512)};
    if (rejectChunks && t === 'daw-sampler-chunk') throw Error('Injected host failure.');
    return runtime.command({t,request:crypto.randomUUID(),...payload});
  }})};

  const original = createWorking({libraryId,source,name:'Glass',selection:[2000,22000],
    recipe:[{type:'fade',inFrames:80,outFrames:300},{type:'pitchShift',semitones:3}]});
  const other = await saveWorking(root,createWorking({libraryId,source,name:'Short glass',selection:[400,8200]}));
  assert.notEqual(original.instrumentId,other.instrumentId);
  assert.notEqual(original.id,other.id);
  assert.throws(() => workingInstrument(original),{code:'render-required'});
  const rendered = await renderWorking(root,original,{run:processWav});
  assert.equal(rendered.rendered.frames,Math.round(20000 * 44100/48000));
  assert.deepEqual(rendered.rendered.recipe.operations,[{type:'trim',start:2000,end:22000},
    ...original.recipe,{type:'rate',sampleRate:44100}]);
  assert.equal(rendered.rendered.source.sha256,source.sha256);
  assert.equal(rendered.rendered.channels,2);
  assert.equal(original.rendered,null);
  const tuned = updateWorking(rendered,{name:'Felt glass',rootNote:55});
  assert.deepEqual(tuned.rendered,rendered.rendered);
  assert.equal(updateWorking(tuned,{selection:[400,6000]}).rendered,null);
  assert.throws(() => updateWorking(tuned,{selection:[30,20]}),{code:'invalid-working'});
  const saved = await saveWorking(root,tuned);
  const reopened = await openWorking(await diskDirectory(dir),saved.id);
  assert.deepEqual(reopened,saved);
  await assert.rejects(saveWorking(root,tuned),{code:'working-conflict'});
  assert.deepEqual((await listWorking(root)).map(d=>d.id),[tuned.id,other.id]);
  assert.deepEqual((await openWorking(root,other.id)).selection,[400,8200]);

  const path = 'Instruments/Glass';
  rejectChunks = true;
  await assert.rejects(promoteWorking(root,reopened,{player,path}),/Injected host failure/);
  await assert.rejects(readFile(join(dir,path,'instrument.json')),{code:'ENOENT'});
  assert.equal(runtime.pending,null);
  rejectChunks = false;
  const ref = await promoteWorking(root,reopened,{player,path});
  assert.equal(ref.revision,1);
  assert.equal(runtime.banks.size,0,'preflight freed its temporary bank');
  assert(!requests.includes('daw-sampler-live'));
  const model = await load(root,ref);
  assert.equal(model.regions[0].root,55);
  assert.deepEqual(model.regions[0].frames,[0,rendered.rendered.frames]);
  assert.equal((await prepare(root,ref)).samples.get(rendered.rendered.id).length,rendered.rendered.frames*2);
  const copy = await workingFromRef(root,ref);
  const competitor = await workingFromRef(root,ref);
  assert.notEqual(copy.id,competitor.id);
  assert.deepEqual(copy.selection,original.selection);
  assert.deepEqual(copy.recipe,original.recipe);
  assert.deepEqual(copy.source,source);
  await mkdir(join(dir,'Collected'));
  const portable = await diskDirectory(join(dir,'Collected'));
  const collected = await workingFromRef(portable,await collect(root,ref,portable));
  assert.notEqual(collected.source.path,source.path);
  assert.equal(collected.source.sha256,source.sha256);
  assert.deepEqual(collected.rendered.source.path,collected.source.path);
  assert.deepEqual(collected.selection,original.selection);
  const damaged = await diskDirectory(dir,{onClose(target) {
    if (target === join(dir,path,'instrument.json')) throw Error('Injected pointer failure.');
  }});
  await assert.rejects(promoteWorking(damaged,copy,{player}),{code:'filesystem-error'});
  assert.equal(JSON.parse(await readFile(join(dir,path,'instrument.json'))).revision,1);
  const next = await promoteWorking(root,updateWorking(copy,{rootNote:57}),{player});
  assert.equal(next.revision,2);
  assert.equal((await load(root,next)).regions[0].root,57);
  assert.equal((await load(root,ref)).regions[0].root,55);
  await assert.rejects(promoteWorking(root,competitor,{player}),{code:'revision-conflict'});
  const preview = await prepareWorking(player,root,competitor);
  assert.notEqual(preview.libraryId,ref.libraryId);
  assert(!preview.path);
  assert(!requests.includes('daw-sampler-live'));
  const unchanged = await readFile(join(dir,source.path));
  assert.deepEqual(unchanged,Buffer.from(await wav.arrayBuffer()));
  unchanged[46] ^= 1;
  await writeFile(join(dir,source.path),unchanged);
  await assert.rejects(promoteWorking(root,updateWorking(copy,{baseRef:next}),{player}),{code:'digest-mismatch'});
  assert.equal(JSON.parse(await readFile(join(dir,path,'instrument.json'))).revision,2);
  console.log('PASS physical independent copies, states, rendering, source hashes, two revisions, interruption, conflict and real WASM preflight without adoption');
} finally {
  await rm(dir,{recursive:true,force:true});
}
