// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diskDirectory} from './filesystem.mjs';
import {initializeLibrary,importOriginal,publish,load,prepare} from '../../web/sampler-library.js';
import {mapSample} from '../../web/sampler.js';
import {encodeSample,processWav,renderDerivative} from '../../web/sampler-offline.js';
const dir=await mkdtemp(join(tmpdir(),'sampler-edit-'));
try{
  const root=await diskDirectory(dir);await initializeLibrary(root);
  const pcm=new Float32Array(24000);
  for(let i=2400;i<21600;i++)pcm[i]=.5*Math.sin(2*Math.PI*220*(i-2400)/48000);
  const original=encodeSample({pcm,channels:1,sampleRate:48000});
  const stored=await importOriginal(root,original,'Samples/Originals/phone.wav');
  const recipe=[{type:'trimSilence',thresholdDb:-54,marginFrames:4},{type:'fade',inFrames:80,outFrames:80},
    {type:'normalizePeak',targetDb:-3},{type:'rate',sampleRate:44100}];
  const {sample}=await renderDerivative(root,stored,recipe,'Samples/Processed/phone.wav',{run:processWav});
  assert.equal(sample.source.sha256,stored.sha256);assert.deepEqual(sample.recipe.operations,recipe);
  assert.deepEqual(await readFile(join(dir,stored.path)),Buffer.from(await original.arrayBuffer()));
  const processed=new Blob([await readFile(join(dir,sample.path))]);
  const observations=await processWav(processed,{type:'analyze'});
  assert.equal(observations.pitch.root,57);assert(Math.abs(observations.pitch.cents)<10);
  assert(Math.abs(observations.peak-10**(-3/20))<.002);
  const ref=await publish(root,mapSample(sample,observations.pitch.root),{path:'Instruments/Phone',expectedRevision:0});
  const reopened=await load(await diskDirectory(dir),ref);
  assert.deepEqual(reopened.samples[0].recipe,sample.recipe);
  assert.equal((await prepare(root,ref)).samples.get(sample.id).length,sample.frames);
  console.log('PASS immutable 48 kHz original to 44.1 kHz derivative to reopenable chromatic instrument');
}finally{await rm(dir,{recursive:true,force:true});}
const {instrumentFromSlices}=await import('../../web/sampler-offline.js');
const {compile,explainNote}=await import('../../web/sampler-instrument.js');
const descriptor={id:'drums',path:'Samples/Originals/hits.wav',sha256:'1'.repeat(64),channels:1,sampleRate:44100,frames:300};
const kit=instrumentFromSlices(descriptor,[100,200]);
assert.deepEqual(kit.regions.map(r=>r.frames),[[0,100],[100,200],[200,300]]);
assert.equal(explainNote(compile(kit),{type:'noteOn',note:37,velocity:98}).voices[0].regionId,'slice-2');
