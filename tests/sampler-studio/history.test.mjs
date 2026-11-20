// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diskDirectory} from './filesystem.mjs';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime} from '../../web/sampler-runtime.js';
import {importOriginal, initializeLibrary, load} from '../../web/sampler-library.js';
import {decodeWav} from '../../web/sampler-wav.js';
import {encodeSample, processWav} from '../../web/sampler-offline.js';
import {createWorking, saveWorking, updateWorking, renderWorking, promoteWorking, openWorking,
  createCheckpoint, checkpointWorking, branchWorking, restoreCheckpoint, undoWorking, redoWorking,
  previewWorkingWav, startFromOriginal, continueFromRendered, discardWorking, repromoteWorking} from '../../web/sampler-working.js';

const dir = await mkdtemp(join(tmpdir(),'sampler-history-'));
try {
  const root = await diskDirectory(dir);
  const library = await initializeLibrary(root);
  const pcm = Float32Array.from({length:4800}, (_,i) => .5*Math.sin(i/10));
  const wav = encodeSample({sampleRate:48000,channels:1,pcm});
  const source = await importOriginal(root,wav,'Samples/Originals/test.wav');
  const audio = file => decodeWav(file,{anyRate:true});
  const preview = (root,draft,through) => previewWorkingWav(root,draft,{through,run:processWav});
  const clean = createWorking({libraryId:library.id,source,name:'Toy',selection:[800,3600]});
  const stages = [{type:'gain',db:-9,bypass:true},{type:'reverse'}];
  const legacy = {...clean};
  delete legacy.sliceMarkers; // Saved before source markers were introduced.
  const marked=updateWorking(legacy,{sliceMarkers:[900,1950]});
  assert.deepEqual(undoWorking(marked).sliceMarkers,[]);
  assert.throws(()=>updateWorking(marked,{sliceMarkers:[1950,900]}),/slice markers/);
  const edits = updateWorking(marked,{recipe:stages});
  let working = await renderWorking(root,edits,{run:processWav});
  assert.deepEqual(working.rendered.recipe.operations,[{type:'trim',start:800,end:3600},{type:'reverse'},{type:'rate',sampleRate:44100}]);
  const first = await audio(await preview(root,working,0));
  assert.equal(first.sampleRate,48000);
  assert.deepEqual((await audio(await preview(root,working,1))).pcm,first.pcm);
  const reverse = await audio(await preview(root,working,2));
  assert.equal(reverse.sampleRate,48000);
  assert.deepEqual(reverse.pcm,first.pcm.slice().reverse());
  const baked = await preview(root,working);
  const full = await audio(baked);
  assert.equal(full.sampleRate,44100);
  const checkpoints = await createCheckpoint(root,working,'Reversed');
  const checkpoint = checkpoints.history.checkpoints[0];
  assert.equal(checkpoints.generation,1);
  assert.equal(checkpoint.workingId,checkpoints.id);
  working = updateWorking(checkpoints,{rootNote:47, recipe:[...stages,{type:'gain',db:-6}]});
  assert.equal(working.rendered,null);
  let undone = undoWorking(working);
  assert.equal(undone.rootNote,60);
  assert.deepEqual(undone.rendered,checkpoints.rendered);
  const changed = redoWorking(undone);
  assert.deepEqual(changed.recipe,working.recipe);
  assert.equal(changed.rendered,null);
  assert.equal(updateWorking(undone,{name:'Kitchen'}).history.redo.length,0);
  assert.deepEqual(redoWorking(await saveWorking(root,undone)).recipe,working.recipe);
  const saved = await openWorking(await diskDirectory(dir),checkpoints.id);
  assert.deepEqual((await audio(await preview(root,await checkpointWorking(root,saved,checkpoint.id)))).pcm,full.pcm);
  const stored = await readFile(join(dir,'Drafts/Checkpoints',working.id,checkpoint.id+'.json'),'utf8');
  assert(!Object.hasOwn(JSON.parse(stored).snapshot,'history'));
  await assert.rejects(createCheckpoint(root,checkpoints,'Stale checkpoint'),{code:'working-conflict'});

  const restored = await restoreCheckpoint(root,saved,checkpoint.id);
  const branch = await branchWorking(root,saved,checkpoint.id,'New idea');
  assert.equal(branch.name,'New idea');
  assert.deepEqual(restored.sliceMarkers,[900,1950]);
  assert.equal(restored.lineage.action,'restore');
  assert.equal(branch.lineage.action,'branch');
  assert.equal(restored.lineage.checkpointId,checkpoint.id);
  assert.notEqual(restored.id,branch.id);
  assert.equal(restored.generation,0);
  assert.equal(restored.rendered.path,branch.rendered.path);
  assert.notEqual(restored.instrumentId,branch.instrumentId);
  assert.equal((await readdir(join(dir,'Samples/Processed',working.id))).filter(f=>f.endsWith('.wav')).length,1);
  const fresh = await startFromOriginal(root,createWorking({libraryId:library.id,source:checkpoints.rendered}));
  assert.equal(fresh.source.path,source.path);
  assert.deepEqual(fresh.selection,[0,source.frames]);

  const engine = new Engine(await readFile('.local/build/waswan-256.wasm'),
    await readFile('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
  engine.advance(4000);
  const runtime = new SamplerRuntime(engine.ex);
  const player = {requests:() => ({async request(t,payload) {
    if (t === 'daw-sampler-patch') return {patch:new Uint8Array(512)};
    return runtime.command({t,request:crypto.randomUUID(),...payload});
  }})};
  const ref = await promoteWorking(root,saved,{player,path:'Instruments/Toy'});
  const tagged = updateWorking(saved,{baseRef:ref});
  const continued = await saveWorking(root,continueFromRendered(tagged));
  const continuedSaved = await openWorking(root,continued.id);
  assert.equal(continuedSaved.source.path,tagged.rendered.path);
  assert.deepEqual(continuedSaved.selection,[0,tagged.rendered.frames]);
  assert.deepEqual(continuedSaved.recipe,[]);
  assert.equal(continuedSaved.rootNote,tagged.rootNote);
  assert.equal(continuedSaved.instrumentId,tagged.instrumentId);
  assert.deepEqual(continuedSaved.history.checkpoints,[checkpoint]);
  assert.deepEqual(continuedSaved.baseRef,ref);
  const next = await promoteWorking(root,updateWorking(tagged,{rootNote:70}),{player});
  const latest = updateWorking(tagged,{baseRef:next});
  const reset = await startFromOriginal(root,latest);
  assert.deepEqual(reset.baseRef,next);
  assert.equal(reset.instrumentId,latest.instrumentId);
  assert.notEqual(reset.id,latest.id);
  // Undo an edit with a new official pointer. Neither direction can unpublish it.
  assert.deepEqual(undoWorking(updateWorking(latest,{name:'Edited'})).baseRef,next);
  const third = await repromoteWorking(root,latest,1,{player});
  for (const [version,pitch] of [[ref,60],[next,70],[third,60]]) {
    assert.equal((await load(root,version)).regions[0].root,pitch);
  }
  assert.equal(third.revision,3);
  await assert.rejects(repromoteWorking(root,latest,1,{player}),{code:'revision-conflict'});
  const discarded = await discardWorking(root,updateWorking(latest,{name:'Throw away'}));
  assert.equal(discarded.id,saved.id);
  assert.equal(discarded.baseRef.revision,3);
  assert.equal(discarded.name,'Toy');
  assert.deepEqual(discarded.history.checkpoints,[checkpoint]);
  assert.deepEqual(discarded.history.undo,[]);
  const afterRestart = await openWorking(await diskDirectory(dir),discarded.id);
  const old = await checkpointWorking(root,afterRestart,checkpoint.id);
  assert.deepEqual((await audio(await preview(root,old))).pcm,full.pcm);
  assert.deepEqual(await readFile(join(dir,source.path)),Buffer.from(await wav.arrayBuffer()));

  const denied = await diskDirectory(dir,{onClose(target) {
    if (target.endsWith('.json')) throw new DOMException('Permission denied','NotAllowedError');
  }});
  await assert.rejects(createCheckpoint(denied,afterRestart,'Denied'),{code:'permission-required'});
  const still = await openWorking(root,afterRestart.id);
  assert.equal(still.generation,afterRestart.generation);
  assert.deepEqual(still.history.checkpoints,[checkpoint]);
  console.log('PASS checkpoint PCM A/B, stage rate and bypass, undo/redo, independent restore and branch, conflict, permissions, re-promotion and discarded history after reopening');
} finally {
  await rm(dir,{recursive:true,force:true});
}
