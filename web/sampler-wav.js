// SPDX-License-Identifier: GPL-3.0-only

import {SamplerError} from './sampler-instrument.js';

const error = (code, message) => new SamplerError(code, message);
const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

export function asBlob(source) {
  if (source instanceof Blob) return source;
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return new Blob([source]);
  throw error('invalid-wav', 'Choose a WAV file or WAV bytes.');
}

const fourCC = (view, offset) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1),
  view.getUint8(offset + 2), view.getUint8(offset + 3));
const readSlice = async (file, start, end) => new DataView(await file.slice(start, end).arrayBuffer());

export async function inspectWav(source, {anyRate = false, sampleLoops = false} = {}) {
  const file = asBlob(source);
  if (file.size < 12) throw error('invalid-wav', 'The WAV header is truncated.');
  const header = await readSlice(file, 0, 12);
  if (fourCC(header, 0) !== 'RIFF' || fourCC(header, 8) !== 'WAVE') {
    throw error('invalid-wav', 'Choose a little-endian RIFF WAV file.');
  }
  const end = header.getUint32(4, true) + 8;
  if (end < 12 || end > file.size) throw error('invalid-wav', 'The RIFF container is truncated.');
  let format, data, count = 0, embeddedLoops = 0;
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) throw error('invalid-wav', 'The WAV chunk header is truncated.');
    if (++count > 4096) throw error('unsupported-feature', 'The WAV contains too many chunks.');
    const chunk = await readSlice(file, offset, offset + 8);
    const kind = fourCC(chunk, 0);
    const length = chunk.getUint32(4, true);
    const first = offset + 8;
    offset = first + length + (length & 1);
    if (offset > end) throw error('invalid-wav', 'The WAV chunk data is truncated.');
    if (kind === 'fmt ') {
      if (format || length < 16) throw error('invalid-wav', 'The WAV format chunk is missing fields or duplicated.');
      const info = await readSlice(file, first, first + 16);
      format = {
        encoding: info.getUint16(0, true),
        channels: info.getUint16(2, true),
        sampleRate: info.getUint32(4, true),
        bytesPerSecond: info.getUint32(8, true),
        blockAlign: info.getUint16(12, true),
        bits: info.getUint16(14, true),
      };
    }
    if (kind === 'smpl' && sampleLoops) {
      if (length < 36) throw error('invalid-wav', 'The WAV sampler chunk is truncated.');
      const loops = (await readSlice(file, first + 28, first + 32)).getUint32(0, true);
      if (loops * 24 > length - 36) throw error('invalid-wav', 'The WAV sampler loop records are truncated.');
      embeddedLoops += loops;
    }
    if (kind === 'data') {
      if (data) throw error('invalid-wav', 'The WAV has more than one data chunk.');
      data = {offset: first, length};
    }
  }
  if (!format || !data) throw error('invalid-wav', 'The WAV requires both a format chunk and audio data.');
  const {encoding, channels, sampleRate, bytesPerSecond, blockAlign, bits} = format;
  if (encoding !== 1 || bits !== 16 || ![1, 2].includes(channels) || sampleRate < 1 || (!anyRate && sampleRate !== 44100)) {
    throw error('unsupported-feature', anyRate ? 'Choose a 16-bit PCM mono or stereo WAV.' : 'Choose a 44.1 kHz, 16-bit PCM mono or stereo WAV.');
  }
  if (blockAlign !== channels * 2 || bytesPerSecond !== sampleRate * blockAlign || !data.length || data.length % blockAlign) {
    throw error('invalid-wav', 'The WAV frame length or byte rate is invalid.');
  }
  const metadata = {offset: data.offset, frames: data.length / blockAlign, channels, sampleRate, size: file.size};
  if (sampleLoops) metadata.sampleLoops = embeddedLoops;
  return metadata;
}

export function decodePCM(bytes, {offset, frames, channels}) {
  const length = frames * channels;
  if (littleEndian) return new Int16Array(bytes, offset, length).slice();
  const view = new DataView(bytes, offset, length * 2);
  return Int16Array.from({length}, (_, index) => view.getInt16(index * 2, true));
}

export async function decodeWav(source, options) {
  const file = asBlob(source);
  const metadata = await inspectWav(file, options);
  return {...metadata, pcm: decodePCM(await file.arrayBuffer(), metadata)};
}
