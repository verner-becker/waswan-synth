// SPDX-License-Identifier: GPL-3.0-only
import {wavHeader} from './studio-format.js';

export function checkFrameRange({start, end}, frames) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > frames || start >= end) {
    throw Error('Choose a start frame before the end frame, within the WAV.');
  }
}

// Each column holds [min,max] for each channel. Keep one PCM block in memory,
// including when the requested view covers many minutes of stereo audio.
export async function waveformPeaks(file, layout, {start = 0, end = layout.frames, bins = 1024} = {}) {
  checkFrameRange({start, end}, layout.frames);
  if (!Number.isSafeInteger(bins) || bins < 1 || bins > 4096) throw Error('Invalid waveform resolution.');
  const {offset, channels} = layout;
  bins = Math.min(bins, end - start);
  const peaks = new Int16Array(bins * channels * 2);
  for (let i = 0; i < peaks.length; i += 2) {
    peaks[i] = 32767;
    peaks[i + 1] = -32768;
  }
  const stride = channels * 2;
  const blockFrames = 262144 / stride;
  for (let frame = start; frame < end; frame += blockFrames) {
    const next = Math.min(end, frame + blockFrames);
    const block = new DataView(await file.slice(offset + frame * stride, offset + next * stride).arrayBuffer());
    for (let f = frame; f < next; f++) {
      const bin = Math.floor((f - start) * bins / (end - start));
      for (let c = 0; c < channels; c++) {
        const value = block.getInt16((f - frame) * stride + c * 2, true);
        const index = (bin * channels + c) * 2;
        peaks[index] = Math.min(peaks[index], value);
        peaks[index + 1] = Math.max(peaks[index + 1], value);
      }
    }
  }
  return peaks;
}

// A Blob built from a file slice can be streamed by the existing audio context.
// Build a standard PCM header even if the input has ancillary RIFF chunks.
export function rangeWav(file, layout, range) {
  checkFrameRange(range, layout.frames);
  const {channels, sampleRate, offset} = layout;
  const stride = channels * 2;
  const bytes = (range.end - range.start) * stride;
  const header = wavHeader(0);
  const view = new DataView(header);
  view.setUint32(4, 36 + bytes, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * stride, true);
  view.setUint16(32, stride, true);
  view.setUint32(40, bytes, true);
  return new Blob([header, file.slice(offset + range.start * stride, offset + range.end * stride)], {type: 'audio/wav'});
}
