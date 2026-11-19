// SPDX-License-Identifier: GPL-3.0-only
import fs from 'node:fs';
export const directory = '.local/validation/mellotron-a';
export const fileName = directory + '/reference-C4.wav';
export const notes = [60, 64, 67];
export const hz = note => 220 * 2 ** ((note - 60) / 12);

// Deliberately record A3 and map it to C4. A fallback synth playing the
// requested MIDI chord would give different frequencies.
export function writeFixture() {
  const frames = 88200, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(88200, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    bytes.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * 220 * i / 44100)), 44 + 2 * i);
  fs.mkdirSync(directory, {recursive:true});
  fs.writeFileSync(fileName, bytes);
  return bytes;
}

// Hann-windowed projection of the left channel in a known musical interval.
export function amplitude(pcm, start, frames, frequency) {
  let re = 0, im = 0;
  for (let i = 0; i < frames; i++) {
    const angle = 2 * Math.PI * frequency * i / 44100;
    const sample = pcm[(start + i) * 2] * (1 - Math.cos(2 * Math.PI * i / frames));
    re += sample * Math.cos(angle); im += sample * Math.sin(angle);
  }
  return 2 * Math.hypot(re, im) / frames;
}
