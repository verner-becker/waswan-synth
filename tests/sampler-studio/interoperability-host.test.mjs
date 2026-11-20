// SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {preparePair} from '../../web/mellotron-library.js';
import {TapeRuntime} from '../../web/mellotron-runtime.js';
import {tapeDefaults} from '../../web/mellotron-settings.js';
import {createInstrument} from '../../web/sampler-instrument.js';
import {
  createSamplerPreset, importOriginal, initializeLibrary, materializeSamplerPreset, prepare, publish, saveSamplerPreset,
} from '../../web/sampler-library.js';
import {encodeSample} from '../../web/sampler-offline.js';
import {packSampler, SamplerRuntime} from '../../web/sampler-runtime.js';
import {exportTapeBank} from '../../web/sampler-tape-export.js';
import {amplitude} from '../mellotron-a/fixture.mjs';
import {diskDirectory} from './filesystem.mjs';
import {pcmWav} from './fixtures.mjs';

const artifacts = resolve(process.env.WASWAN_BUILD_ROOT ?? '.');
const staged = join(artifacts, '.local/www/simulator');
const {Engine} = await import(pathToFileURL(join(staged, 'engine.js')));
const wasm = await readFile(process.env.WASWAN_TEST_WASM ?? join(staged, 'obervave-voice.wasm'));
const factory = await readFile(join(artifacts, 'upstream/SMKSYNTH/web/simulator/factory-session.bin'));

test('a WAV exported from the sampler plays through the real Mellotron host at its mapped pitch', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'waswan-interop-audio-'));
  t.after(() => rm(scratch, {recursive: true, force: true}));
  const libraryPath = join(scratch, 'Library'), output = join(scratch, 'Tapes');
  await Promise.all([mkdir(libraryPath), mkdir(output)]);
  const root = await diskDirectory(libraryPath);
  const destination = await diskDirectory(output);
  await initializeLibrary(root, {id: 'tape-host'});
  // A recorded 220 Hz tone is deliberately mapped to C4. Exporting it for C5 bakes
  // the octave and makes a synth fallback distinguishable from the tape audio.
  const source = pcmWav(Int16Array.from({length: 44100 * 2}, (_, index) =>
    Math.sin(Math.PI * 2 * 220 * Math.floor(index / 2) / 44100) * (index % 2 ? 6500 : 9000)));
  const sample = await importOriginal(root, source, 'Samples/Originals/A3 recorded at C4.wav', {
    provenance: 'Synthetic originally recorded 220 Hz', license: 'GPL-3.0-only',
  });
  const ref = await publish(root, createInstrument({
    id: 'one-tape', name: 'One tape', samples: [sample],
    regions: [{id: 'tone', root: 60, sample: sample.id, group: 'main'}],
  }), {path: 'Instruments/One tape', expectedRevision: 0});
  const exported = await exportTapeBank(root, ref, {roots: [72]}, destination, {name: 'Audio evidence', acceptLosses: true});
  const banks = [exported.name, exported.name];
  const prepared = await preparePair(await diskDirectory(output), banks);
  assert.equal(prepared.id, exported.id);
  assert.deepEqual(prepared.regions.map(region => region.root), [72]);

  const engine = new Engine(wasm, factory);
  engine.advance(5000);
  const x = engine.ex, runtime = new TapeRuntime(x);
  assert(x.waswan_mel_patch());
  const patch = new Uint8Array(x.memory.buffer, x.waswan_daw_stage_buffer(), 80);
  patch[38] = 0;
  patch[39] = 1;
  patch[42] = patch[43] = patch[47] = 0;
  assert(x.waswan_daw_apply(1, x.waswan_daw_token()));
  engine.input({t: 'voice-mode', part: 0, mode: 0});
  x.waswan_daw_taps(1);

  const regions = prepared.regions.map(region => ({...region, frames: region.pcm.length}));
  const token = runtime.command({t: 'daw-tape-begin', request: 'interop', regions});
  let offset = 0;
  for (const region of regions) {
    for (let start = 0; start < region.frames; start += 32768) {
      const pcm = region.pcm.slice(start, start + 32768);
      runtime.command({t: 'daw-tape-chunk', token, pcm, offset});
      offset += pcm.length;
    }
  }
  runtime.command({t: 'daw-tape-commit', token, tape: {banks, id: prepared.id,
    settings: {...tapeDefaults(), attack: 1, release: 3, mix: 0}}});

  const frames = 8192;
  const audio = new Float32Array(frames * 2);
  engine.input({t: 'midi', st: 0x90, d1: 72, d2: 100});
  engine.advance(15);
  for (let first = 0; first < frames; first += 128) {
    engine.render(128);
    for (let channel = 0; channel < 2; channel++) {
      const output = new Float32Array(x.memory.buffer, x.waswan_daw_output(0, channel), 128);
      output.forEach((level, index) => { audio[2 * (first + index) + channel] = level; });
    }
  }
  engine.input({t: 'midi', st: 0x80, d1: 72, d2: 0});
  const measure = hz => amplitude(audio, 0, frames, hz);
  const alternatives = [220, 523.25, 880].map(measure);
  const expectedHz = 440, fundamental = measure(expectedHz);
  assert(fundamental > .01, 'captured tape audio is audible');
  assert(fundamental > 10 * Math.max(...alternatives), 'captured pitch identifies the resampled tape');
  const measuredHz = Array.from({length: 21}, (_, index) => 430 + index)
    .reduce((best, hz) => measure(hz) > measure(best) ? hz : best);
  assert(Math.abs(measuredHz - expectedHz) <= 2);
  const report = {root: 72, originalHz: 220, expectedHz, measuredHz, fundamental, alternatives,
    preparedFrames: exported.frames, capturedFrames: frames, sampleRate: 44100};
  console.log(JSON.stringify(report));

  const evidence = process.env.WASWAN_INTEROP_EVIDENCE;
  if (evidence) {
    await mkdir(evidence, {recursive: true});
    const encoded = encodeSample({pcm: audio, channels: 2, sampleRate: 44100});
    await Promise.all([
      writeFile(join(evidence, 'tape-host.json'), JSON.stringify(report, null, 2) + '\n'),
      writeFile(join(evidence, 'tape-host.wav'), new Uint8Array(await encoded.arrayBuffer())),
      writeFile(join(evidence, 'tape-exported-root-72.wav'), await readFile(join(output, exported.name, '72.wav'))),
    ]);
  }
});

test('a materialized preset changes the real sampler sound and reuses the prepared PCM', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'waswan-preset-audio-'));
  t.after(() => rm(scratch, {recursive: true, force: true}));
  const root = await diskDirectory(scratch);
  await initializeLibrary(root, {id: 'preset-host'});
  const source = pcmWav(Int16Array.from({length: 44100 * 2}, (_, index) =>
    Math.sin(Math.PI * 2 * 220 * Math.floor(index / 2) / 44100) * 9000));
  const sample = await importOriginal(root, source, 'Samples/Originals/Stereo tone.wav');
  const ref = await publish(root, createInstrument({
    id: 'tone-source', name: 'Original tone', samples: [sample],
    regions: [{id: 'tone', sample: sample.id, group: 'main', root: 60}],
  }), {path: 'Instruments/Original tone', expectedRevision: 0});
  const path = 'Presets/Right octave.json';
  const gainDb = 20 * Math.log10(0.5);
  await saveSamplerPreset(root, createSamplerPreset({id: 'right-octave', ref, controls: {gainDb, cents: 1200, pan: 1}}), {path});
  const tuned = await materializeSamplerPreset(root, path, {id: 'right-octave-instrument', path: 'Instruments/Right octave'});
  const engine = new Engine(wasm, factory);
  engine.advance(4000);
  const x = engine.ex, runtime = new SamplerRuntime(x);
  assert(x.waswan_mel_patch());
  assert(x.waswan_daw_apply(1, x.waswan_daw_token()));
  x.waswan_daw_taps(1);

  const install = async sourceRef => {
    const loaded = await prepare(root, sourceRef);
    const {token, sampleIds} = runtime.command({t: 'daw-sampler-begin', request: crypto.randomUUID(),
      ref: sourceRef, packed: packSampler(loaded.instrument)});
    for (const sampleId of sampleIds) {
      const data = loaded.samples.get(sampleId);
      for (let offset = 0; offset < data.length; offset += 32768) {
        const pcm = data.subarray(offset, offset + 32768);
        runtime.command({t: 'daw-sampler-chunk', token, sampleId, offset, pcm});
      }
    }
    runtime.command({t: 'daw-sampler-commit', token});
    return sampleIds;
  };
  assert.deepEqual(await install(ref), [sample.id]);
  assert.deepEqual(await install(tuned), []);

  const frames = 8192;
  const capture = binding => {
    runtime.applySlots(runtime.prepareSlots([{...binding, trackId: 'track', part: 0}]));
    assert(x.waswan_daw_note(0, 60, 110));
    const channels = [new Float32Array(frames * 2), new Float32Array(frames * 2)];
    for (let first = 0; first < frames; first += 128) {
      engine.render(128);
      channels.forEach((audio, channel) => {
        const data = new Float32Array(x.memory.buffer, x.waswan_daw_owned_output(0, channel), 128);
        data.forEach((level, index) => { audio[2 * (first + index)] = level; });
      });
    }
    assert(x.waswan_daw_note(0, 60, 0));
    engine.advance(200);
    return channels;
  };
  const baseline = capture(ref), preset = capture(tuned);
  const original = amplitude(baseline[1], 0, frames, 220);
  const adjusted = amplitude(preset[1], 0, frames, 440);
  assert(original > .1 && adjusted > .05);
  assert(Math.abs(adjusted / original - .5) < .01);
  assert(amplitude(preset[1], 0, frames, 220) < adjusted / 100);
  assert(preset[0].every(value => value === 0));
  console.log(JSON.stringify({preset: tuned.instrumentId, originalHz: 220, presetHz: 440, gainRatio: adjusted / original, leftSilent: true}));
});
