// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {wavHeader} from '../../web/studio-format.js';
import {processWav} from '../../web/sampler-offline.js';
import {decodeWav} from '../../web/sampler-wav.js';

const frames = 44100*420, block = new Uint8Array(1024*1024);
const tail = new Int16Array([16384,-8192,8192,-4096]);
const bytes = frames*4 - tail.byteLength;
const segments = Array(Math.floor(bytes/block.length)).fill(block);
segments.push(block.subarray(0,bytes%block.length),tail);
class ObservedFile extends Blob {
  reads = [];
  slice(start,end) {
    this.reads.push(end-start);
    return super.slice(start,end);
  }
  arrayBuffer() { throw Error('Unexpected whole-file read'); }
}
const file = new ObservedFile([wavHeader(frames),...segments]);
await assert.rejects(processWav(file,{type:'analyze'}),/budget/);
const {wav} = await processWav(file,{type:'edit',recipe:[{type:'trim',start:frames-2,end:frames}]});
assert.deepEqual((await decodeWav(wav)).pcm,tail);
assert(Math.max(...file.reads)<=16);
console.log('PASS offline edit reads two stereo frames from seven-minute source without allocating whole PCM');
