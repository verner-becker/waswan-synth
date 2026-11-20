// SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {preparePair} from '../../web/mellotron-library.js';
import {pairFrames} from '../../web/mellotron-settings.js';
import {compile, createInstrument, explainNote} from '../../web/sampler-instrument.js';
import {importOriginal, initializeLibrary, load, publish} from '../../web/sampler-library.js';
import {exportSfz, importSfz, inspectSfzImport, parseSfz, planSfzExport} from '../../web/sampler-sfz.js';
import {exportTapeBank, planTapeBank, renderTapeBank} from '../../web/sampler-tape-export.js';
import {decodeWav} from '../../web/sampler-wav.js';
import {diskDirectory} from './filesystem.mjs';
import {createSamplerFixtures, pcmWav} from './fixtures.mjs';

const fail = code => error => {
  assert.equal(error.code, code, error.stack);
  return true;
};
const close = (actual, expected, delta = 1e-10) => assert(Math.abs(actual - expected) <= delta, `${actual} ≉ ${expected}`);
const isMissing = error => (assert.equal(error.code, 'ENOENT'), true);

async function directories(t, hooks) {
  const scratch = await mkdtemp(join(tmpdir(), 'waswan-interop-'));
  t.after(() => rm(scratch, {recursive: true, force: true}));
  const sourcePath = join(scratch, 'Source'), libraryPath = join(scratch, 'Library'), destinationPath = join(scratch, 'Destination');
  await Promise.all([sourcePath, libraryPath, destinationPath].map(path => mkdir(path)));
  const source = await diskDirectory(sourcePath);
  const root = await diskDirectory(libraryPath);
  const destination = await diskDirectory(destinationPath, hooks);
  return {scratch, sourcePath, libraryPath, destinationPath, source, root, destination};
}

test('minimal SFZ profile parses inherited groups, sample names and inclusive loops and rejects sequences', () => {
  const document = parseSfz(`\uFEFF// Portuguese names, adjacent headers and CRLF\r
<group> sample=Sounds\\Piano Macio.wav key=Bb3 volume=-3.5 tune=12 loVel=10\r
<region> lokey=54 hikey=60 pitch_keycenter=C4 hivel=79 loop_mode=loop_continuous loop_start=5 loop_end=47 end=99\r
<region> key=C#4 sample=./Sounds/Piano Forte.wav amp_veltrack=0 tune=-3 loop_mode=one_shot\r
<group><region>key=72 sample="Mão esquerda.wav"`);
  assert.equal(document.ok, true, JSON.stringify(document.diagnostics));
  const [one, two, three] = document.regions;
  assert.deepEqual(one.key, [54, 60]);
  assert.equal(one.root, 60);
  assert.equal(one.sample, 'Sounds/Piano Macio.wav');
  assert.equal(one.cents, 12);
  assert.equal(one.gainDb, -3.5);
  assert.deepEqual(one.velocity, [10, 79]);
  assert.deepEqual(one.range, [0, 100]);
  assert.deepEqual(one.loop, {start: 5, end: 48, mode: 'forward'});
  assert.equal(one.velocityCurve, 'convex');
  assert.equal(two.sample, 'Sounds/Piano Forte.wav');
  assert.deepEqual(two.key, [61, 61]);
  assert.equal(two.mode, 'oneShot');
  assert.equal(two.velocityCurve, 'fixed');
  assert.equal(two.gainDb, -3.5);
  assert.equal(three.gainDb, 0);
  assert.equal(three.sample, 'Mão esquerda.wav');

  for (const value of ['../Escape.wav', 'C:\\Escape.wav', '/Escape.wav', 'https://outside/Escape.wav']) {
    const invalid = parseSfz('<region> sample=' + value);
    assert.equal(invalid.ok, false, value);
    assert(invalid.diagnostics.some(entry => entry.code === 'invalid-path' || entry.code === 'unsupported-sample'));
  }
  const sequence = parseSfz(`
<group> seq_length=2
<region> key=60 lovel=1 hivel=38 seq_position=1 sample=pt1.wav
<region> key=60 lovel=48 hivel=127 seq_position=2 sample=pt2.wav`);
  assert.equal(sequence.ok, false);
  assert(sequence.diagnostics.every(entry => entry.code === 'unsupported-sequence'));
  assert(parseSfz('#include "external.sfz"\n<region> sample=ok.wav').diagnostics.some(entry => entry.code === 'unsupported-directive'));
  assert(parseSfz('<region> sample=note.wav volume=-145 tune=120').diagnostics.filter(entry => entry.code === 'invalid-opcode').length === 2);
});

const stereoBytes = pcmWav(Int16Array.from({length: 256}, (_, index) => (index % 44) * 600 - 12000));
const monoBytes = pcmWav(Int16Array.from({length: 128}, (_, index) => index * 100 - 6400), {channels: 1});

function withSamplerLoop(wav) {
  const sampleChunk = new Uint8Array(8 + 36 + 24);
  sampleChunk.set(new TextEncoder().encode('smpl'));
  const chunk = new DataView(sampleChunk.buffer);
  chunk.setUint32(4, sampleChunk.length - 8, true);
  chunk.setUint32(8 + 28, 1, true);
  chunk.setUint32(8 + 36 + 8, 5, true);
  chunk.setUint32(8 + 36 + 12, 31, true);
  const output = new Uint8Array(wav.length + sampleChunk.length);
  output.set(wav);
  output.set(sampleChunk, wav.length);
  new DataView(output.buffer).setUint32(4, output.length - 8, true);
  return output;
}

test('SFZ import, external bundle and reimport preserve note and velocity selection, gain, tuning and loop frames', async t => {
  const {sourcePath, libraryPath, destinationPath, source, root, destination} = await directories(t);
  await initializeLibrary(root, {id: 'sfz-test'});
  await mkdir(join(sourcePath, 'Sounds'));
  await writeFile(join(sourcePath, 'Sounds/Piano Macio.wav'), stereoBytes);
  await writeFile(join(sourcePath, 'Sounds/Piano Forte.wav'), monoBytes);
  await symlink(join(sourcePath, 'Sounds'), join(sourcePath, 'Alias'), 'dir');
  await writeFile(join(sourcePath, 'Sounds/Embedded.wav'), withSamplerLoop(monoBytes));

  const text = `<group> volume=-3.5 tune=24
<region> sample=Sounds/Piano Macio.wav lokey=A3 hikey=C4 pitch_keycenter=C4 lovel=21 hivel=100 amp_veltrack=0 offset=4 end=95 loop_mode=loop_continuous loop_start=6 loop_end=77
<region> sample=Sounds/Piano Forte.wav key=C#4 volume=-6 tune=-8 lovel=24 hivel=127 loop_mode=one_shot
<group> tune=-5
<region> sample=Sounds/Piano Macio.wav key=C5 volume=1 lovel=1 hivel=127 amp_veltrack=0`;
  const opt = {id: 'sfz-piano', name: 'SFZ Piano', path: 'Instruments/SFZ Piano', license: 'GPL-3.0-only'};
  assert.equal((await inspectSfzImport(source, text)).samples.size, 2);
  assert.equal((await inspectSfzImport(source, '<region> sample=Alias/Piano Macio.wav')).ok, false);
  const embedded = await inspectSfzImport(source, '<region> sample=Sounds/Embedded.wav');
  assert(embedded.diagnostics.some(entry => entry.code === 'embedded-loop'));
  const ignored = await inspectSfzImport(source, '<region> sample=Sounds/Embedded.wav loop_mode=no_loop');
  assert.equal(ignored.ok, true);
  assert.equal(ignored.samples.get('Sounds/Embedded.wav').sampleLoops, 1);
  assert(parseSfz('<control> default_path=Sounds/\n<region> sample=Embedded.wav').diagnostics.some(entry => entry.code === 'unsupported-path'));
  const missing = await inspectSfzImport(source, '<region> sample=missing.wav');
  assert.equal(missing.diagnostics[0].code, 'missing-sample');
  const invalidFrames = await inspectSfzImport(source, '<region> sample=Sounds/Piano Macio.wav end=128');
  assert.equal(invalidFrames.diagnostics[0].code, 'invalid-region');
  const badLoop = await inspectSfzImport(source, '<region> sample=Sounds/Piano Macio.wav loop_mode=loop_continuous loop_start=5 loop_end=128');
  assert.equal(badLoop.diagnostics[0].code, 'invalid-loop');
  await assert.rejects(importSfz(root, source, text + ' pan=42', opt), fail('sfz-plan-required'));
  await assert.rejects(access(join(libraryPath, 'Samples/Originals/SFZ')), isMissing);

  const {ref} = await importSfz(root, source, text, opt);
  const instrument = await load(root, ref);
  assert.equal(instrument.samples.length, 2);
  assert.deepEqual(instrument.regions[0].frames, [4, 96]);
  assert.deepEqual(instrument.regions[0].loop, {start: 6, end: 78, mode: 'forward'});
  assert.equal(instrument.regions[0].gainDb, -3.5);
  assert.equal(instrument.regions[1].gainDb, -6);
  assert.equal(instrument.regions[1].mode, 'oneShot');
  assert.equal(instrument.regions[2].cents, -5);
  assert.deepEqual(await readFile(join(libraryPath, instrument.samples[0].path)), Buffer.from(stereoBytes));

  const folder = 'SFZ Exchange', name = 'Portable.sfz';
  assert.equal((await exportSfz(root, ref, destination, {folder, name})).diagnostics.length, 0);
  const exchange = join(destinationPath, folder);
  const output = await readFile(join(exchange, name), 'utf8');
  const provenance = JSON.parse(await readFile(join(exchange, 'provenance.json'), 'utf8'));
  assert.equal(provenance.samples[0].license, opt.license);
  assert.equal(provenance.samples[0].sha256, instrument.samples[0].sha256);
  assert.match(output, /end=95 .*loop_end=77/u);
  assert.match(output, /volume=-3\.5/u);
  const {ref: copy} = await importSfz(root, await diskDirectory(exchange), output, {
    id: 'sfz-copy', path: 'Instruments/SFZ Copy',
  });
  const first = compile(instrument), second = compile(await load(root, copy));
  for (const note of [55, 56, 57, 59, 60, 61, 62, 71, 72, 73]) {
    for (const velocity of [1, 20, 21, 24, 99, 100, 101, 127]) {
      const compare = plan => explainNote(plan, {type: 'noteOn', note, velocity}).voices.map(({gain, cents}) => [gain, cents]);
      assert.deepEqual(compare(first), compare(second));
    }
  }
  await assert.rejects(exportSfz(root, ref, destination, {folder: 'sfz exchange', name}), fail('path-conflict'));
  assert.equal(await readFile(join(exchange, name), 'utf8'), output);
});

test('SFZ flattening requires explicitly selected articulations and variants and report acceptance', async t => {
  const {root, destination, destinationPath} = await directories(t);
  const {piano} = await createSamplerFixtures(root);
  const model = await load(root, piano);
  assert.equal(planSfzExport(model).ok, false);
  const bright = {articulations: {style: 'bright'}};
  const plan = planSfzExport(model, bright);
  assert.equal(plan.ok, true);
  assert.equal(plan.samples.length, 3);
  assert(plan.diagnostics.some(entry => entry.code === 'release-region'));
  await assert.rejects(exportSfz(root, piano, destination, {folder: 'Reported', ...bright}), fail('sfz-plan-required'));
  await assert.rejects(access(join(destinationPath, 'Reported')), isMissing);
  await exportSfz(root, piano, destination, {folder: 'Reported', acceptLosses: true, ...bright});
  assert.equal((await readFile(join(destinationPath, 'Reported/instrument.sfz'), 'utf8')).match(/<region>/gu).length, 3);
});

function tone(frames, {frequency = 440, opposite = false} = {}) {
  return pcmWav(Int16Array.from({length: frames * 2}, (_, index) => {
    const value = Math.sin(2 * Math.PI * frequency * Math.floor(index / 2) / 44100) * 10000;
    return index % 2 ? value * (opposite ? -1 : .5) : value;
  }));
}

function crossings(samples) {
  let count = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 && samples[i] >= 0) count++;
  return count * 44100 / samples.length;
}

test('Mellotron plan reports ambiguity, eight-second cropping and combined region and PCM limits', async t => {
  const {root} = await directories(t);
  const {piano} = await createSamplerFixtures(root);
  const model = await load(root, piano);
  const missing = planTapeBank(model);
  assert.equal(missing.ok, false);
  assert(missing.diagnostics.some(entry => entry.code === 'velocity-choice'));
  const variants = Object.fromEntries(model.variations.map(variation => [variation.id, 'a']));
  const mapping = {velocity: 72, articulations: {style: 'felt'}, variants};
  assert(planTapeBank(model, mapping).diagnostics.some(entry => entry.code === 'ambiguous-root'));
  const chosen = planTapeBank(model, {...mapping, regions: {48: 'soft-48-a', 60: 'soft-60-a', 72: 'soft-72-a'}});
  assert(chosen.ok);
  assert.deepEqual(chosen.entries.map(entry => entry.regionId), ['soft-48-a', 'soft-60-a', 'soft-72-a']);
  chosen.entries.forEach(entry => close(entry.gain, Math.SQRT1_2));
  const partner = {...mapping, velocity: 43, otherFrames: pairFrames - 2, otherRegions: 47};
  const limited = planTapeBank(model, partner);
  assert.equal(limited.ok, false);
  assert(limited.diagnostics.some(entry => entry.code === 'pcm-budget'));
  assert(limited.diagnostics.some(entry => entry.code === 'region-budget'));
  assert(planTapeBank(model, {...partner, roots: [48, 48]}).diagnostics.some(entry => entry.code === 'duplicate-root'));
  const source = createInstrument({
    id: 'long', name: 'Long tape',
    samples: [{id: 'long', path: 'Samples/Originals/fake.wav', frames: 44100 * 9, sampleRate: 44100, channels: 1, sha256: 'a'.repeat(64)}],
    regions: [{id: 'r1', sample: 'long', group: 'main', root: 60}],
  });
  const clipped = planTapeBank(source);
  assert.equal(clipped.entries[0].frames, 44100 * 8);
  assert(clipped.diagnostics.some(entry => entry.code === 'truncated'));
});

test('physical Mellotron export closes and reopens WAVs with the existing two-bank loader', async t => {
  let interrupt = false;
  const {root, destination, destinationPath} = await directories(t, {
    onClose(path) {
      if (interrupt && path.endsWith('/Interrupted/72.wav')) throw new Error('simulated write interruption');
    },
  });
  await initializeLibrary(root, {id: 'tape-export'});
  const a = await importOriginal(root, tone(8820), 'Samples/Originals/a.wav', {id: 'a', license: 'GPL-3.0-only', provenance: 'Original synthetic stereo'});
  const b = await importOriginal(root, tone(8820, {opposite: true}), 'Samples/Originals/b.wav', {id: 'b'});
  const ref = await publish(root, createInstrument({
    id: 'tape-source', name: 'Tape source', samples: [a, b], gainDb: -6,
    regions: [
      {id: 'first', sample: a.id, root: 60, key: [69, 73], group: 'main'},
      {id: 'second', sample: b.id, root: 84, key: [84, 84], group: 'main'},
    ],
  }), {path: 'Instruments/Tape Source', expectedRevision: 0});
  const mapping = {roots: [72, 84], seconds: .05};
  const plan = await renderTapeBank(root, ref, mapping);
  assert(plan.ok);
  const decoded = await decodeWav(plan.files[0].content);
  assert.equal(decoded.frames, 2205);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.sampleRate, 44100);
  close(crossings(decoded.pcm), 880, 21);
  close(decoded.pcm.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0), 7500 * 10 ** (-6 / 20), 15);
  assert((await decodeWav(plan.files[1].content)).pcm.every(value => value === 0), 'opposite-phase stereo downmix cancels');

  await assert.rejects(exportTapeBank(root, ref, mapping, destination, {name: 'Unconfirmed'}), fail('tape-plan-required'));
  await assert.rejects(access(join(destinationPath, 'Unconfirmed')), isMissing);
  await assert.rejects(exportTapeBank(root, ref, mapping, destination, {name: 'Unpaired', partner: 'Missing', acceptLosses: true}),
    fail('invalid-partner'));
  await assert.rejects(access(join(destinationPath, 'Unpaired')), isMissing);
  interrupt = true;
  await assert.rejects(exportTapeBank(root, ref, mapping, destination, {name: 'Interrupted', acceptLosses: true}), fail('export-failed'));
  await assert.rejects(access(join(destinationPath, 'Interrupted')), isMissing);
  interrupt = false;
  await mkdir(join(destinationPath, 'Partner'));
  await writeFile(join(destinationPath, 'Partner/60.wav'), monoBytes);
  const saved = await exportTapeBank(root, ref, mapping, destination, {name: 'Tape', partner: 'Partner', acceptLosses: true});
  const pair = await preparePair(await diskDirectory(destinationPath), ['Tape', 'Partner']);
  assert.equal(saved.id, pair.id);
  assert.equal(saved.frames, 2205 * 2 + 128);
  assert.equal(saved.regions, 3);
  assert.deepEqual(pair.regions.map(region => [region.bank, region.root, region.pcm.length]), [[0, 72, 2205], [0, 84, 2205], [1, 60, 128]]);
  const credits = JSON.parse(await readFile(join(destinationPath, 'Tape/waswan-tape.json'), 'utf8'));
  assert.equal(credits.samples[0].provenance, a.provenance);
  assert.equal(credits.samples[0].sha256, a.sha256);
  assert.equal(credits.samples[0].license, a.license);
  const original = await readFile(join(destinationPath, 'Tape/72.wav'));
  await assert.rejects(exportTapeBank(root, ref, mapping, destination, {name: 'TAPE', acceptLosses: true}), fail('path-conflict'));
  assert.deepEqual(await readFile(join(destinationPath, 'Tape/72.wav')), original);
});
