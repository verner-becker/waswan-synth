// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {wavHeader} from '../../web/studio-format.js';
import {decodeWav, inspectWav} from '../../web/sampler-wav.js';
import {encodeSample, processWav} from '../../web/sampler-offline.js';
import {rangeWav} from '../../web/sampler-waveform.js';

const frames = 420 * 44100, block = new Uint8Array(1024 * 1024);
const signal = Int16Array.of(-32000, 12000, -16000, 20000);
const bytes = frames * 4 - signal.byteLength;
class DiskLikeFile extends Blob {
  largestRead = 0;
  reads = 0;
  slice(start, end) {
    this.largestRead = Math.max(this.largestRead, end - start);
    this.reads++;
    return super.slice(start, end);
  }
  arrayBuffer() { throw Error('Whole source was read'); }
}
const file = new DiskLikeFile([wavHeader(frames), ...Array(Math.floor(bytes / block.length)).fill(block),
  block.subarray(0, bytes % block.length), signal]);
const peaks = await processWav(file, {type: 'waveform', bins: 2048});
assert.equal(peaks.length, 2048 * 4);
assert.deepEqual([...peaks.subarray(-4)], [-32000, 0, 0, 20000]);
assert(peaks.subarray(0, -4).every(x => x === 0));
assert(file.largestRead <= 262144 && file.reads > 200);
const range = {start: frames - 2, end: frames};
const detail = await processWav(file, {type: 'waveform', ...range});
assert.deepEqual([...detail], [-32000, -32000, 12000, 12000, -16000, -16000, 20000, 20000]);
const meta = await inspectWav(file);
const preview = await decodeWav(rangeWav(file, meta, range));
const crop = await processWav(file, {type: 'edit', recipe: [{type: 'trim', ...range}]});
assert.deepEqual(preview.pcm, signal);
assert.deepEqual(preview.pcm, (await decodeWav(crop.wav)).pcm);
assert.throws(() => rangeWav(file, meta, {start: -1, end: 0}), /start frame/);
await assert.rejects(processWav(file, {type: 'waveform', start: frames, end: frames}), /start frame/);
const mono = encodeSample({channels: 1, sampleRate: 48000, pcm: Float32Array.of(0, .5, -.25)});
const monoMeta = await inspectWav(mono, {anyRate: true});
const monoExcerpt = await decodeWav(rangeWav(mono, monoMeta, {start: 1, end: 3}), {anyRate: true});
assert.equal(monoExcerpt.sampleRate, 48000);
assert.equal(monoExcerpt.channels, 1);
assert.deepEqual([...monoExcerpt.pcm], [16384, -8192]);
console.log('PASS stereo waveform, preview and crop from 7-minute source, bounded reads of ' + file.largestRead + ' bytes, 48 kHz mono');
