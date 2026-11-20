// SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {compile, createInstrument, explainNote} from '../../web/sampler-instrument.js';
import {
  applySamplerPreset, collect, createSamplerPreset, importOriginal, initializeLibrary, inspectSample,
  listChildren, load, loadSamplerPreset, materializeSamplerPreset, prepare, publish, resolveSamplerPreset,
  saveSamplerPreset, search, updateSampleMetadata, verify,
} from '../../web/sampler-library.js';
import {processWav, renderDerivative} from '../../web/sampler-offline.js';
import {diskDirectory} from './filesystem.mjs';
import {createSamplerFixtures, pcmWav} from './fixtures.mjs';

const fail = code => error => (assert.equal(error.code, code, error.stack), true);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function workspace(t, hooks) {
  const temp = await mkdtemp(join(tmpdir(), 'waswan-library-metadata-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const path = join(temp, 'Library');
  await mkdir(path);
  return {root: await diskDirectory(path, hooks), path, temp};
}

const bytes = pcmWav([0, 12, 48, 10, -30, -45, -23, -12], {channels: 1});

test('standalone sample metadata survives reopening, edits, same-content imports and ordinary folder moves', async t => {
  let keepCatalogLight = false;
  const {root, path} = await workspace(t, {onRead(file) {
    if (keepCatalogLight && file.endsWith('.wav')) throw Error('Catalog attempted to open a WAV.');
  }});
  await initializeLibrary(root, {id: 'meta-test'});
  const original = 'Samples/Originals/Phone/Take.wav';
  const marked = await importOriginal(root, bytes, original, {id: 'shot', name: 'Tampa de panela', tags: ['Cozinha', 'Metal'],
    provenance: {capture: 'Própria'}, license: 'GPL-3.0-only'});
  const legacy = 'Samples/Originals/Legacy.wav';
  await writeFile(join(path, legacy), bytes);
  const unopened = await diskDirectory(path);
  const described = await inspectSample(unopened, original);
  assert.deepEqual(described, marked);
  const sidecar = JSON.parse(await readFile(join(path, original + '.sample.json'), 'utf8'));
  assert.equal(sidecar.format, 'waswan-sampler-sample');
  assert.equal(sidecar.sha256, sha256(bytes));
  assert.equal(sidecar.path, original);
  assert.equal(sidecar.license, marked.license);

  keepCatalogLight = true;
  const items = (await listChildren(root, 'Samples/Originals/Phone')).items;
  assert.deepEqual(items.map(({id, displayName}) => [id, displayName]), [[marked.id, 'Tampa de panela']]);
  assert.equal((await search(root, {kind: 'sample', text: 'panela', tags: ['cozinha']})).items[0].path, original);
  assert.equal((await search(root, {kind: 'sample', text: 'legacy'})).items[0].path, legacy);
  keepCatalogLight = false;
  assert.equal((await inspectSample(unopened, legacy)).sha256, marked.sha256);
  await assert.rejects(updateSampleMetadata(root, original, {name: 'Batedor'}, {expectedSha256: '0'.repeat(64)}), fail('digest-mismatch'));
  const edited = await updateSampleMetadata(root, original, {name: 'Tampa grande', tags: ['Percussão']}, {expectedSha256: marked.sha256});
  assert.deepEqual(edited.tags, ['Percussão']);
  assert.deepEqual(await readFile(join(path, original)), Buffer.from(bytes));
  assert.equal((await importOriginal(root, bytes, original, {id: 'local-manifest-alias'})).id, 'local-manifest-alias');
  assert.equal((await inspectSample(unopened, original)).id, 'shot');

  await rename(join(path, 'Samples/Originals/Phone'), join(path, 'Samples/Originals/Mobile'));
  const moved = original.replace('/Phone/', '/Mobile/');
  assert.equal((await inspectSample(unopened, moved, {verify: true})).id, marked.id);
  assert.equal((await search(root, {kind: 'sample', tags: ['Percussão']})).items[0].path, moved);

  const longName = 'a'.repeat(248) + '.wav';
  const longPath = 'Samples/Originals/' + longName;
  const long = await importOriginal(root, bytes, longPath, {name: 'Nome longo'});
  assert.equal((await inspectSample(root, longPath)).id, long.id);
  assert((await listChildren(root, 'Samples/Originals')).items.every(item => !item.name.endsWith('.sample.json')));
});

test('preset persists a pinned revision and materializes its gain, pan, fine tuning and initial articulation', async t => {
  const {root, path} = await workspace(t);
  const {piano} = await createSamplerFixtures(root);
  const original = await load(root, piano);
  const newer = await publish(root, {...original, name: 'New baseline', gainDb: -20}, {path: piano.path, expectedRevision: 1});
  const draft = createSamplerPreset({
    id: 'piano-near', name: 'Piano próximo', tags: ['Palco'], ref: piano,
    controls: {gainDb: -6, pan: .25, cents: 35, initialArticulations: {style: 'bright'}},
  });
  const name = 'Presets/Shows/Piano próximo.json';
  const saved = await saveSamplerPreset(root, draft, {path: name});
  assert.equal(saved.revision, 1);
  assert.equal(saved.ref.revision, 1);
  assert.deepEqual(await loadSamplerPreset(await diskDirectory(path), name), saved);
  assert.equal((await search(root, {kind: 'preset', tags: ['palco']})).items[0].id, draft.id);
  await assert.rejects(saveSamplerPreset(root, draft, {path: name}), fail('revision-conflict'));
  assert.throws(() => applySamplerPreset({...original, revision: newer.revision}, saved), fail('preset-mismatch'));
  assert.throws(() => createSamplerPreset({...draft, controls: {gainDb: -200}}), fail('invalid-preset'));
  await assert.rejects(saveSamplerPreset(root, {...draft, controls: {initialArticulations: {style: 'unknown'}}}, {
    path: 'Presets/Invalid.json',
  }), fail('invalid-instrument'));

  const moved = 'Instruments/Moved piano';
  await rename(join(path, piano.path), join(path, moved));
  const resolved = await resolveSamplerPreset(root, name);
  assert.equal(resolved.ref.revision, 1);
  assert.equal(resolved.ref.path, moved);
  assert.equal(resolved.instrument.name, 'Fixture piano');
  const opened = await materializeSamplerPreset(root, name, {id: 'piano-near-instrument', path: 'Instruments/Piano próximo'});
  assert.notEqual(opened.instrumentId, piano.instrumentId);
  const prepared = await prepare(root, opened);
  const {voices} = explainNote(prepared.plan, {type: 'noteOn', note: 60, velocity: 72});
  assert.deepEqual(voices.map(voice => voice.regionId), ['bright-60']);
  assert.equal(voices[0].gain, 10 ** (-6 / 20));
  assert.equal(voices[0].pan, .25);
  assert.equal(voices[0].cents, 35);
  assert.deepEqual(prepared.instrument.samples.map(sample => [sample.path, sample.sha256]),
    original.samples.map(sample => [sample.path, sample.sha256]));
  assert.equal((await load(root, newer)).gainDb, -20);
  const race = await Promise.allSettled(['edit A', 'edit B'].map(label =>
    saveSamplerPreset(root, {...saved, name: label}, {path: name, expectedRevision: saved.revision})));
  assert.equal(race.filter(item => item.status === 'fulfilled').length, 1);
  fail('revision-conflict')(race.find(item => item.status === 'rejected').reason);
});

test('collect copies WAVs, 48 kHz ancestors, sample sidecars and ordered recipes before publishing', async t => {
  const {root, path, temp} = await workspace(t);
  await initializeLibrary(root, {id: 'provenance-test'});
  const input = pcmWav(Int16Array.from({length: 480}, (_, index) => Math.round(18000 * Math.sin(index / 8))),
    {channels: 1, sampleRate: 48000});
  const original = await importOriginal(root, input, 'Samples/Originals/Phone.wav', {
    id: 'phone', name: 'Phone capture', tags: ['Session'], provenance: 'Original phone recording fixture', license: 'GPL-3.0-only',
  });
  const operations = [{type: 'trim', start: 5, end: 450}, {type: 'rate', sampleRate: 44100}];
  const {sample: processed} = await renderDerivative(root, original, operations, 'Samples/Processed/Prepared.wav', {run: processWav});
  const gain = [{type: 'gain', db: -4}, {type: 'reverse'}];
  const {sample: derivative} = await renderDerivative(root, processed, gain, 'Samples/Processed/Final.wav', {run: processWav});
  assert.deepEqual((await inspectSample(await diskDirectory(path), derivative.path)).recipe.operations, gain);
  assert.deepEqual((await inspectSample(root, processed.path)).source, {path: original.path, sha256: original.sha256});
  const instrument = await publish(root, createInstrument({
    id: 'trimmed', name: 'Trimmed', samples: [derivative, processed],
    regions: [{id: 'r', root: 60, group: 'main', sample: derivative.id}],
  }), {path: 'Instruments/Trimmed', expectedRevision: 0});

  // Earlier libraries have physical source files without standalone metadata.
  await rm(join(path, processed.path + '.sample.json'));
  const legacy = await inspectSample(root, processed.path);
  assert.equal(legacy.sha256, processed.sha256);
  assert.equal(legacy.recipe, undefined);
  const destinationPath = join(temp, 'Export');
  await mkdir(destinationPath);
  const destination = await diskDirectory(destinationPath);
  const movedOriginal = join(path, 'Samples/Originals/Phone moved.wav');
  await rename(join(path, original.path), movedOriginal);
  await assert.rejects(collect(root, instrument, destination), fail('missing-sample'));
  await assert.rejects(access(join(destinationPath, 'library.json')), /ENOENT/iu);
  await rename(movedOriginal, join(path, original.path));
  const exported = await collect(root, instrument, destination);
  assert.deepEqual(await collect(root, instrument, destination), exported);
  await rm(path, {recursive: true, force: true});
  const copied = await load(destination, exported);
  assert.equal(copied.samples.length, 2);
  assert.equal(copied.samples[0].sha256, derivative.sha256);
  assert.deepEqual(copied.samples[0].recipe.operations, gain);
  const parent = await inspectSample(destination, copied.samples[0].source.path, {verify: true});
  assert.equal(parent.sha256, processed.sha256);
  assert.deepEqual(parent.recipe.operations, operations);
  const ancestor = await inspectSample(destination, parent.source.path, {verify: true});
  assert.equal(ancestor.sha256, original.sha256);
  assert.equal(ancestor.sampleRate, 48000);
  assert.equal(ancestor.license, original.license);
  assert.equal(ancestor.provenance, original.provenance);
  assert.equal(ancestor.name, original.name);
  assert.deepEqual(ancestor.tags, original.tags);
  assert.deepEqual(await readFile(join(destinationPath, ancestor.path)), Buffer.from(input));
  assert((await verify(destination, exported)).ok);
  assert.equal((await prepare(destination, exported)).samples.size, 1);
  assert(compile(copied).memoryBytes < 1000);
});

test('collect detects cyclic source links before opening the destination library', async t => {
  const {root, temp} = await workspace(t);
  await initializeLibrary(root, {id: 'cyclic-source-test'});
  const path = 'Samples/Processed/Cycle.wav';
  const sample = await importOriginal(root, bytes, path, {
    source: {path, sha256: sha256(bytes)},
    recipe: {version: 1, operations: [{type: 'reverse'}]},
  });
  const ref = await publish(root, createInstrument({
    id: 'cycle', name: 'Cycle', samples: [sample], regions: [{id: 'r', root: 60, group: 'main', sample: sample.id}],
  }), {path: 'Instruments/Cycle', expectedRevision: 0});
  const output = join(temp, 'Cycle export');
  await mkdir(output);
  await assert.rejects(collect(root, ref, await diskDirectory(output)), fail('cyclic-source'));
  await assert.rejects(access(join(output, 'library.json')), /ENOENT/iu);
});
