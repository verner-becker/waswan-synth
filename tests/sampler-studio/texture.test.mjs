// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../../.local/www/simulator/engine.js';
import {diskDirectory} from './filesystem.mjs';
import {initializeLibrary, importOriginal, publish, prepare} from '../../web/sampler-library.js';
import {processWav, renderDerivative, encodeSample} from '../../web/sampler-offline.js';
import {mapSample} from '../../web/sampler.js';
import {SamplerRuntime, packSampler} from '../../web/sampler-runtime.js';

const dir = await mkdtemp(join(tmpdir(), 'waswan-granular-instrument-'));
try {
  const root = await diskDirectory(dir);
  await initializeLibrary(root);
  const sampleRate = 44100;
  const pcm = Float32Array.from({length: sampleRate}, (_, i) => .5 * Math.sin(2 * Math.PI * i * 220 / sampleRate));
  const original = await importOriginal(root, encodeSample({pcm, sampleRate, channels:1}), 'Samples/Originals/string.wav');
  const recipe = [{type:'granular', seconds:2, grainMs:160, density:18, positions:[.2,.7], seed:42}];
  const {sample} = await renderDerivative(root, original, recipe, 'Samples/Processed/drone.wav', {run:processWav});
  const ref = await publish(root, mapSample(sample, 57), {path:'Instruments/Drone', expectedRevision:0});
  const prepared = await prepare(await diskDirectory(dir), ref);
  const engine = new Engine(await readFile('.local/build/waswan-256.wasm'),
    await readFile('.local/www/simulator/factory-session.bin'));
  engine.advance(4000);
  const x = engine.ex, runtime = new SamplerRuntime(x);
  assert(x.waswan_mel_patch());
  assert(x.waswan_daw_apply(1, x.waswan_daw_token()));
  x.waswan_daw_taps(1);
  const {token} = runtime.command({t:'daw-sampler-begin',request:'texture',ref,packed:packSampler(prepared.instrument)});
  const data = prepared.samples.get(sample.id);
  for (let offset = 0; offset < data.length; offset += 32768) {
    runtime.command({t:'daw-sampler-chunk', token, sampleId:sample.id, offset, pcm:data.subarray(offset, offset+32768)});
  }
  runtime.command({t:'daw-sampler-commit', token});
  runtime.applySlots(runtime.prepareSlots([{...ref, part:0, trackId:'drone'}]));
  for (const note of [57,64,69]) {
    assert(x.waswan_daw_note(0,note,100));
    let peak = 0;
    for (let i = 0; i < 48; i++) {
      engine.render(128);
      const output = new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,0),128);
      for (const value of output) peak = Math.max(peak, Math.abs(value));
    }
    assert(peak > .04);
    assert(x.waswan_daw_note(0,note,0));
    for (let i=0; i<32; i++) engine.render(128);
  }
  console.log('PASS original to physical granular derivative, cold reopen, three notes in WASM');
} finally {
  await rm(dir, {recursive:true, force:true});
}
