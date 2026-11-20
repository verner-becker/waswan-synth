// SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {access, copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {
  applyEdits, compile, createInstrument, createSelectionState, explainNote, validSamplerRef,
} from '../../web/sampler-instrument.js';
import {
  collect, decodeWav, findCandidates, importOriginal, initializeLibrary, inspect, inspectWav, listChildren,
  load, prepare, publish, readLibrary, readSampleFile, relink, search, verify,
} from '../../web/sampler-library.js';
import {diskDirectory} from './filesystem.mjs';
import {createSamplerFixtures, pcmWav} from './fixtures.mjs';

const fail = code => cause => {
  assert.equal(cause.code, code, cause.stack);
  return true;
};

async function workspace(t, hooks = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'waswan-sampler-test-'));
  t.after(() => rm(scratch, {force: true, recursive: true}));
  const path = join(scratch, 'Physical library');
  await mkdir(path);
  const root = await diskDirectory(path, hooks);
  return {scratch, path, root};
}

const pulse = pcmWav([8192, 0, 0, -4096, -8192, 0, 0, 0], {junk: true});
const samplePath = 'Samples/Originals/Take/One.wav';
const instrumentPath = 'Instruments/Tests/One';
const publishOne = async (root, sample, options = {}) => publish(root, createInstrument({
  id: 'one', name: 'One', samples: [sample],
  regions: [{id: 'test-region', group: 'main', sample: sample.id, root: 60}],
  ...options,
}), {path: instrumentPath, expectedRevision: 0});

const pick = (plan, note, velocity, state, id) => explainNote(plan, {type: 'noteOn', note, velocity, id}, state);
const off = (plan, note, id, state) => explainNote(plan, {type: 'noteOff', note, id}, state);
const pedal = (plan, value, state) => explainNote(plan, {type: 'sustain', value}, state);
const chose = result => result.voices.map(voice => voice.regionId);
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`);

test('RIFF inspection preserves mono, stereo and odd auxiliary chunk alignment', async () => {
  assert.deepEqual(await inspectWav(pulse), {offset: 56, frames: 4, channels: 2, sampleRate: 44100, size: 72});
  assert.deepEqual([...(await decodeWav(new File([pulse], 'pulse.wav'))).pcm], [8192, 0, 0, -4096, -8192, 0, 0, 0]);
  const mono = pcmWav([-32768, -1, 0, 1, 32767], {channels: 1});
  assert.deepEqual([...(await decodeWav(new Blob([mono]))).pcm], [-32768, -1, 0, 1, 32767]);
  await assert.rejects(inspectWav(pulse.slice(0, -1)), fail('invalid-wav'));
  await assert.rejects(inspectWav(new Uint8Array(20)), fail('invalid-wav'));
  await assert.rejects(inspectWav(pcmWav([1, 2, 3])), fail('invalid-wav'));
  const badAlign = pulse.slice();
  new DataView(badAlign.buffer).setUint16(32, 2, true);
  await assert.rejects(inspectWav(badAlign), fail('invalid-wav'));
  const unsupported = pulse.slice();
  new DataView(unsupported.buffer).setUint16(20, 3, true);
  await assert.rejects(inspectWav(unsupported), fail('unsupported-feature'));
});

test('physical import protects originals and stores PCM16 48 kHz for editing', async t => {
  const {root, path, scratch} = await workspace(t);
  const descriptor = await initializeLibrary(root, {id: 'tests', name: 'Filesystem tests'});
  assert.deepEqual(await readLibrary(root), descriptor);
  assert.equal((await initializeLibrary(root, {name: 'Ignored'})).name, 'Filesystem tests');
  await assert.rejects(initializeLibrary(root, {id: 'other'}), fail('library-mismatch'));

  const sample = await importOriginal(root, new File([pulse], 'different-name.wav'), samplePath, {id: 'one', license: 'GPL-3.0-only'});
  assert.equal(sample.sha256, createHash('sha256').update(pulse).digest('hex'));
  assert.equal(sample.size, pulse.length);
  assert.deepEqual(await readFile(join(path, samplePath)), Buffer.from(pulse));
  assert.equal((await importOriginal(root, pulse, samplePath, {id: 'again'})).sha256, sample.sha256);
  await assert.rejects(importOriginal(root, pulse, 'Samples/Originals/Take/one.wav'), fail('path-conflict'));
  await assert.rejects(importOriginal(root, pulse, 'Samples/Originals/take/Two.wav'), fail('path-conflict'));
  const different = pcmWav([1, 2], {channels: 1});
  await assert.rejects(importOriginal(root, different, samplePath), fail('path-conflict'));
  await importOriginal(root, different, 'Samples/Originals/Another/One.wav');

  for (const invalid of ['/Samples/Originals/One.wav', 'Samples/Originals/../One.wav', 'Samples/Originals//One.wav',
    'https://invalid/One.wav', 'Samples/Originals/NUL.wav', 'Samples/Originals/C:\\One.wav']) {
    await assert.rejects(importOriginal(root, pulse, invalid), fail('invalid-path'));
  }
  const outside = join(scratch, 'outside');
  await mkdir(outside);
  await symlink(outside, join(path, 'Samples/Originals/escape'), 'dir');
  await assert.rejects(importOriginal(root, pulse, 'Samples/Originals/escape/One.wav'), fail('invalid-path'));
  await assert.rejects(access(join(outside, 'One.wav')));
  await symlink(join(path, samplePath), join(path, 'Samples/Originals/alias.wav'));
  await assert.rejects(readSampleFile(root, {...sample, path: 'Samples/Originals/alias.wav'}), fail('invalid-path'));

  const wav48 = pcmWav([100, -100, 200, -200], {sampleRate: 48000});
  await assert.rejects(inspectWav(wav48), fail('unsupported-feature'));
  const raw = await importOriginal(root, wav48, 'Samples/Originals/48k.wav', {id: '48k'});
  assert.equal(raw.sampleRate, 48000);
  assert.deepEqual([...(await decodeWav(await readSampleFile(root, raw), {anyRate: true})).pcm], [100, -100, 200, -200]);
  await assert.rejects(publishOne(root, raw), fail('unsupported-feature'));
  const derived = await importOriginal(root, pulse, 'Samples/Processed/Faster.wav', {id: 'processed',
    source: {id: raw.id, sha256: raw.sha256}, recipe: [{type: 'test'}]});
  const ref = await publishOne(root, derived);
  assert(validSamplerRef(ref));
  assert.deepEqual((await load(root, ref)).samples[0].source, {id: raw.id, sha256: raw.sha256});
  assert.equal(validSamplerRef({...ref, path: 'Instruments/Tests/revisions/One'}), false);
});

test('library revisions serialize, preserve history and detect interrupted or changed publication', async t => {
  let failClose = false, mutateAfterRevision = false, path;
  const work = await workspace(t, {
    async onClose(target) {
      if (failClose && target.endsWith('/instrument.json')) throw new Error('simulated interruption');
      if (mutateAfterRevision && target.endsWith('/revisions/4.json')) {
        const current = join(path, instrumentPath, 'instrument.json');
        const raw = JSON.parse(await readFile(current, 'utf8'));
        await writeFile(current, JSON.stringify({...raw, name: 'External edit'}));
      }
    },
  });
  const {root} = work;
  path = work.path;
  await initializeLibrary(root, {id: 'revisions'});
  const sample = await importOriginal(root, pulse, samplePath, {id: 'one'});
  const ref = await publishOne(root, sample);
  const draft = await load(root, ref);
  const expected = {path: ref.path, expectedRevision: ref.revision};

  failClose = true;
  await assert.rejects(publish(root, {...draft, name: 'Unfinished'}, expected), fail('filesystem-error'));
  assert.equal(JSON.parse(await readFile(join(path, ref.path, 'revisions/2.json'))).name, 'Unfinished');
  assert.equal((await load(root, ref)).name, 'One');
  await assert.rejects(load(root, {...ref, revision: 2}), fail('missing-revision'));

  failClose = false;
  const results = await Promise.allSettled([
    publish(root, {...draft, name: 'First'}, expected),
    publish(await diskDirectory(path), {...draft, name: 'Second'}, expected),
  ]);
  const accepted = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  fail('revision-conflict')(rejected[0].reason);
  const latest = await load(root, accepted[0].value);
  assert.equal(latest.revision, 2);
  assert(['First', 'Second'].includes(latest.name));
  assert.equal((await load(root, ref)).name, 'One');

  const third = await publish(root, {...latest, name: 'Third'}, {path: ref.path, expectedRevision: 2});
  mutateAfterRevision = true;
  await assert.rejects(publish(root, {...latest, name: 'Fourth'}, {path: ref.path, expectedRevision: 3}), fail('revision-conflict'));
  assert.equal((await load(root, third)).name, 'External edit');
  await assert.rejects(load(root, {...ref, revision: 4}), fail('missing-revision'));
});

test('catalog reads metadata, resolves a moved library and relinks missing WAVs explicitly', async t => {
  const {root, scratch, path} = await workspace(t, {onRead(target) {
    if (target.endsWith('avoid-reading.wav')) throw new Error('a catalog must not open PCM');
  }});
  const {single, piano} = await createSamplerFixtures(root);
  await writeFile(join(path, 'Samples/Originals/avoid-reading.wav'), pulse);
  const {items, nextCursor} = await listChildren(root, 'Instruments/Fixtures', {limit: 1});
  assert.equal(items[0].id, piano.instrumentId);
  assert.equal(items[0].expandable, true);
  assert.equal((await listChildren(root, 'Instruments/Fixtures', {cursor: nextCursor})).items[0].id, single.instrumentId);
  assert.equal((await search(root, {kind: 'instrument', tags: ['PIANO'], text: 'fixture'})).items[0].id, piano.instrumentId);
  assert.equal((await search(root, {kind: 'sample', text: 'avoid-reading'})).items[0].name, 'avoid-reading.wav');

  const movedRoot = join(scratch, 'Moved library');
  await rename(path, movedRoot);
  const moved = await diskDirectory(movedRoot);
  const movedInstrumentPath = 'Instruments/Moved piano';
  await rename(join(movedRoot, piano.path), join(movedRoot, movedInstrumentPath));
  const restored = await inspect(moved, piano);
  assert.equal(restored.ref.path, movedInstrumentPath);
  assert.deepEqual(restored.ref, {...piano, path: movedInstrumentPath});
  assert((await verify(moved, piano)).ok);
  await assert.rejects(load(moved, {...piano, libraryId: 'wrong'}), fail('library-mismatch'));

  const sample = restored.instrument.samples[0];
  const alt = 'Samples/Originals/Rescue A.wav';
  const alt2 = 'Samples/Processed/Rescue B.wav';
  await rename(join(movedRoot, sample.path), join(movedRoot, alt));
  await copyFile(join(movedRoot, alt), join(movedRoot, alt2));
  const bad = 'Samples/Originals/Forgery.wav';
  const different = await readFile(join(movedRoot, alt));
  different[different.length - 3] ^= 1;
  await writeFile(join(movedRoot, bad), different);
  const report = await verify(moved, piano);
  assert.equal(report.ok, false);
  assert.equal(report.items.find(item => item.id === sample.id).status, 'missing-sample');
  const candidates = await findCandidates(moved, sample);
  assert.equal(candidates.status, 'ambiguous-sample');
  assert.deepEqual(candidates.candidates.map(item => item.path), [alt, alt2]);
  await assert.rejects(relink(moved, piano, sample.id, bad), fail('digest-mismatch'));
  const relinked = await relink(moved, piano, sample.id, candidates.candidates[0]);
  assert.equal(relinked.revision, 2);
  assert((await verify(moved, relinked)).ok);
  assert.equal((await load(moved, piano)).samples[0].path, sample.path);
  await assert.rejects(relink(moved, piano, sample.id, alt, {expectedRevision: 2}), fail('revision-conflict'));
  const replaced = await relink(moved, relinked, sample.id, {path: bad, provenance: 'Explicit substitution'}, {replace: true});
  assert.equal(replaced.revision, 3);
  assert.equal((await load(moved, replaced)).samples[0].provenance, 'Explicit substitution');
});

test('collection exports a self-contained copy, pinning the chosen revision and source metadata', async t => {
  const {root, scratch, path} = await workspace(t);
  const {piano} = await createSamplerFixtures(root);
  const first = await load(root, piano);
  const second = await publish(root, {...first, tags: ['Changed']}, {path: piano.path, expectedRevision: 1});
  const destPath = join(scratch, 'Export');
  await mkdir(destPath);
  const destination = await diskDirectory(destPath);
  const exported = await collect(root, second, destination, {path: 'Instruments/Copy'});
  assert.equal(exported.instrumentId, second.instrumentId);
  assert.equal(exported.revision, second.revision);
  assert.notEqual(exported.libraryId, second.libraryId);
  assert.deepEqual(await collect(root, second, destination, {path: 'Instruments/Copy'}), exported);
  await rm(path, {force: true, recursive: true});
  const copied = await prepare(await diskDirectory(destPath), exported);
  assert.equal(copied.samples.size, first.samples.length);
  assert.deepEqual(copied.plan.instrument.tags, ['Changed']);
  for (const [index, sample] of copied.instrument.samples.entries()) {
    const source = first.samples[index];
    assert.notEqual(sample.path, source.path);
    assert.equal(sample.sha256, source.sha256);
    assert.deepEqual(sample.provenance, source.provenance);
    assert.equal(sample.license, source.license);
    await access(join(destPath, sample.path));
  }
});

test('prepare validates budget before opening audio and exposes cancellation, permissions and corruption', async t => {
  let denied = false, readWav = 0;
  const {root, path} = await workspace(t, {onRead(target) {
    if (target.endsWith('.wav')) {
      readWav++;
      if (denied) throw new DOMException('revoked', 'NotAllowedError');
    }
  }});
  await initializeLibrary(root, {id: 'budget'});
  const sample = await importOriginal(root, pulse, samplePath, {id: 'pulse'});
  const ref = await publishOne(root, sample);
  readWav = 0;
  await assert.rejects(prepare(root, ref, {limits: {memoryBytes: 15}}), fail('budget-exceeded'));
  assert.equal(readWav, 0);
  await assert.rejects(prepare(root, ref, {maxFileBytes: 70}), fail('budget-exceeded'));
  assert.equal(readWav, 1);
  const progress = [];
  const good = await prepare(root, ref, {onProgress: report => progress.push(report.completed)});
  assert.deepEqual([...good.samples.get(sample.id)], [8192, 0, 0, -4096, -8192, 0, 0, 0]);
  assert.deepEqual(progress, [0, 1]);

  const abort = new AbortController();
  await assert.rejects(prepare(root, ref, {signal: abort.signal, onProgress: ({completed}) => {
    if (!completed) abort.abort();
  }}), fail('cancelled'));
  denied = true;
  await assert.rejects(prepare(root, ref), fail('permission-required'));
  assert.equal((await verify(root, ref)).items[0].status, 'permission-required');
  denied = false;
  await writeFile(join(path, samplePath), pulse.slice(0, -1));
  await assert.rejects(prepare(root, ref), fail('digest-mismatch'));
  const corrupted = pulse.slice();
  corrupted[60] ^= 1;
  await writeFile(join(path, samplePath), corrupted);
  await assert.rejects(prepare(root, ref), fail('digest-mismatch'));
});

test('piano selects key zones, equal-power velocity layers, round robin and captured release', async t => {
  const {root} = await workspace(t);
  const {piano} = await createSamplerFixtures(root);
  const {plan} = await prepare(root, piano);
  for (const note of [48, 60, 72]) {
    assert.deepEqual(chose(pick(plan, note, 63)), [`soft-${note}-a`]);
    assert.deepEqual(chose(pick(plan, note, 64)), [`soft-${note}-a`]);
    assert.deepEqual(chose(pick(plan, note, 80)), [`hard-${note}-a`]);
    assert.deepEqual(chose(pick(plan, note, 90)), [`hard-${note}-a`]);
  }
  const first = pick(plan, 60, 72, undefined, 1);
  assert.deepEqual(chose(first), ['soft-60-a', 'hard-60-a']);
  first.voices.forEach(voice => near(voice.weight, Math.SQRT1_2));
  const second = pick(plan, 60, 72, first.state, 2);
  assert.deepEqual(chose(second), ['soft-60-b', 'hard-60-b']);
  assert.deepEqual(chose(pick(plan, 60, 72, first.state, 2)), chose(second));
  assert.deepEqual(chose(pick(plan, 100, 70)), []);
  let state = pedal(plan, 127, second.state).state;
  const switchArt = pick(plan, 25, 127, state, 3);
  assert.equal(switchArt.consumed, true);
  assert.deepEqual(chose(switchArt), []);
  const liftedFirst = off(plan, 60, 1, switchArt.state);
  assert.deepEqual(chose(liftedFirst), []);
  assert.deepEqual(liftedFirst.releases, []);
  const bright = pick(plan, 60, 72, liftedFirst.state, 4);
  assert.deepEqual(chose(bright), ['bright-60']);
  const pedalUp = pedal(plan, 0, bright.state);
  assert.deepEqual(pedalUp.releases.map(event => event.id), [1]);
  assert.deepEqual(chose(pedalUp), ['felt-release']);
  const final = off(plan, 60, 2, pedalUp.state);
  assert.deepEqual(chose(final), ['felt-release']);
  assert.deepEqual(chose(off(plan, 60, 2, final.state)), []);
  assert.equal(off(plan, 25, 3, final.state).consumed, true);

  const retrigger = pick(plan, 60, 72, first.state, 1);
  assert.deepEqual(retrigger.releases.map(event => event.id), [1]);
  assert.deepEqual(chose(retrigger), ['soft-60-b', 'hard-60-b']);
  const reset = explainNote(plan, {type: 'panic'}, second.state);
  assert.deepEqual(reset.state, createSelectionState());
  assert.deepEqual(chose(reset), []);
});

test('mapping edits validate references, gain, tuning, pan, fades and deterministic random sets', () => {
  const sample = {id: 'pulse', path: samplePath, sha256: 'a'.repeat(64), frames: 4, channels: 2, sampleRate: 44100};
  const duplicate = {...sample, id: 'duplicate'};
  const initial = createInstrument({
    id: 'edits', name: 'Edits', samples: [sample, duplicate], gainDb: -3, cents: 20, pan: 0.2,
    groups: [{id: 'main', gainDb: -2, cents: 10, pan: 0.2}],
    variations: [{id: 'r', mode: 'random', seed: 12345, avoidRepeat: true, order: ['a', 'b', 'c']}],
  });
  const region = {sample: 'pulse', group: 'main', root: 60, gainDb: -1, cents: 5, pan: 0.8, key: [60, 72],
    keyFadeIn: [60, 64], keyFadeLaw: 'linear', velocityCurve: 'linear', frames: [0, 4], loop: {start: 1, end: 4}};
  assert.throws(() => applyEdits(initial, [{op: 'add', collection: 'regions', value: {...region, id: 'bad', sample: 'missing'}}]),
    fail('invalid-instrument'));
  assert.throws(() => applyEdits(initial, [{op: 'add', collection: 'regions', value: {...region, id: 'bad', loop: {start: 3, end: 5}}}]),
    fail('invalid-instrument'));
  const draft = applyEdits(initial, ['a', 'b', 'c'].map(member => ({op: 'add', collection: 'regions',
    value: {...region, id: member, sample: member === 'a' ? 'pulse' : 'duplicate', variation: {set: 'r', member}}})));
  assert.equal(initial.regions.length, 0);
  const plan = compile(draft);
  assert.equal(plan.memoryBytes, 16, 'same PCM digest only reserves one copy');
  const play = () => {
    let state = createSelectionState();
    const sequence = [];
    for (let id = 0; id < 15; id++) {
      const result = pick(plan, 62, 127, state, id);
      state = result.state;
      assert.equal(result.voices.length, 1);
      const [voice] = result.voices;
      near(voice.weight, .5);
      near(voice.gain, .5 * 10 ** (-6 / 20));
      assert.equal(voice.cents, 235);
      assert.equal(voice.pan, 1);
      sequence.push(voice.regionId);
    }
    return sequence;
  };
  const sequence = play();
  assert.deepEqual(sequence, play());
  assert.equal(new Set(sequence).size, 3);
  assert(sequence.slice(1).every((member, index) => member !== sequence[index]));
  assert.deepEqual(chose(pick(plan, 60, 127)), [], 'zero key fade is excluded');
  assert.throws(() => compile(draft, {}, {regions: 2}), fail('budget-exceeded'));
  assert.throws(() => compile(createInstrument({...draft, outputs: [{id: 'main', channels: 2}, {id: 'out', channels: 2}],
    groups: [{id: 'main', output: 'out'}]})), fail('unsupported-feature'));
});
