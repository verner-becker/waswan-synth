// SPDX-License-Identifier: GPL-3.0-only
export async function readSample(file, root, seconds = 8) {
  const maxFrames = seconds * 44100;
  if (!Number.isInteger(root) || root < 0 || root > 127) throw Error('Choose a MIDI root between 0 and 127.');
  if (file.size < 44 || file.size > maxFrames * 2 + 65536) throw Error('Choose a mono WAV of up to '+seconds+' seconds.');
  const bytes = await file.arrayBuffer(), view = new DataView(bytes);
  const tag = at => String.fromCharCode(...new Uint8Array(bytes, at, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength)
    throw Error('Invalid RIFF/WAVE length.');
  let format = false, start, frames;
  for (let at = 12; at < bytes.byteLength;) {
    if (at + 8 > bytes.byteLength) throw Error('Incomplete WAV chunk.');
    const id = tag(at), size = view.getUint32(at + 4, true), data = at + 8;
    at = data + size + (size % 2);
    if (at > bytes.byteLength) throw Error('Truncated WAV chunk.');
    if (id === 'fmt ') {
      if (format || size < 16 || view.getUint16(data, true) !== 1 || view.getUint16(data + 2, true) !== 1 ||
          view.getUint32(data + 4, true) !== 44100 || view.getUint32(data + 8, true) !== 88200 ||
          view.getUint16(data + 12, true) !== 2 || view.getUint16(data + 14, true) !== 16)
        throw Error('Use mono PCM16 at 44.1 kHz.');
      format = true;
    } else if (id === 'data') {
      if (start !== undefined || size % 2 || size < 8 || size > maxFrames * 2) throw Error('Invalid sample length.');
      start = data;
      frames = size / 2;
    }
  }
  if (!format || start === undefined) throw Error('Missing WAV format or data.');
  return {pcm: new Int16Array(bytes, start, frames), root};
}
