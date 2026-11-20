// SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import {createInstrument} from '../../web/sampler-instrument.js';
import {parseSfz, planSfzExport} from '../../web/sampler-sfz.js';
import {planTapeBank} from '../../web/sampler-tape-export.js';

test('exports preserve fixed-pitch MIDI pad notes and report unsupported output and DSP routing', () => {
  const instrument = createInstrument({
    id: 'kit', name: 'Choked kit', kind: 'kit',
    outputs: [{id: 'main', channels: 2}, {id: 'aux', channels: 2}],
    groups: [{id: 'hat', output: 'aux', choke: 'cymbals', voiceLimit: 3, retrigger: 'cut',
      filter: {type: 'lowpass', cutoffHz: 6000}, auxEnvelope: {attackMs: 4}}],
    modulation: [{source: {cc: 1}, destination: 'gainDb', depth: 3}],
    pads: [{id: 'left', index: 1, note: 36, groups: ['hat']}, {id: 'right', index: 2, note: 42, groups: ['hat']}],
    samples: [{id: 'hit', path: 'Samples/Originals/hit.wav', sha256: '1'.repeat(64), channels: 1,
      frames: 700, sampleRate: 44100}],
    regions: [{id: 'a', group: 'hat', sample: 'hit', root: 60, key: [0, 127], cents: 12, reverse: true,
      loop: {mode: 'pingPong', start: 10, end: 200, crossfade: 25}}],
  });

  const sfz = planSfzExport(instrument);
  assert(sfz.ok);
  const parsed = parseSfz(sfz.text);
  assert(parsed.ok);
  assert.deepEqual(parsed.regions.map(region => [region.key, region.root, region.cents]), [
    [[36, 36], 36, 12], [[42, 42], 42, 12],
  ]);
  assert(sfz.diagnostics.some(entry => entry.code === 'pads'));
  assert(sfz.diagnostics.some(entry => entry.code === 'loop-mode'));
  assert(sfz.diagnostics.some(entry => entry.code === 'output-route' && entry.output === 'aux'));
  assert.deepEqual(new Set(sfz.diagnostics.find(entry => entry.code === 'group-behavior').fields),
    new Set(['filter', 'auxEnvelope', 'modulation', 'choke', 'voiceLimit', 'retrigger', 'reverse']));

  const tape = planTapeBank(instrument);
  assert(tape.ok);
  assert.deepEqual(tape.entries.map(entry => [entry.root, entry.cents]), [[36, 12], [42, 12]]);
  assert(tape.diagnostics.some(entry => entry.code === 'output-route' && entry.output === 'aux'));
  assert.deepEqual(new Set(tape.diagnostics.find(entry => entry.code === 'playback-behavior').fields),
    new Set(['filter', 'auxEnvelope', 'modulation', 'loop', 'choke', 'voiceLimit', 'retrigger', 'reverse']));
});
