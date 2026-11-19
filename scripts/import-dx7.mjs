// SPDX-License-Identifier: GPL-3.0-only
import {mkdir, open, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {toneFile, TONE_FILE_EXTENSION} from '../web/tone-bank.js';

// ANALOG parameters in obv_params.h order. Start in POLY with the vintage
// pitch variation off. The FM mix below mutes the analog layer.
const analogParameters = [
  1,64,110,0, 1,64,100,24, 0,0,64,70, 80,20,90,64,4, 0,40,60,
  20,70,40,60, 10,70,100,60, 0,70,0,1, 0,0,0,0,2,2,
  0,4,30,0, 0,0,2,100, 0, 0,3,1,64, 0, 40,50,0, 3,50,70,0, 80,60,20,0
];

function convertVoice(voice, packed, slot) {
  const nameStart = packed ? 118 : 145;
  const name = String.fromCharCode(...voice.subarray(nameStart, nameStart + 10))
    .replace(/[^\x20-\x7e]/g, ' ').trim() || `DX7 ${slot}`;
  const nameBytes = Array.from(name.padEnd(10), char => char.charCodeAt(0));
  const algorithm = voice[packed ? 110 : 134];
  const feedback = packed ? voice[111] & 7 : voice[135];
  const patch = [...analogParameters, ...nameBytes, 0,0,0,0,0,0,0, 0xf1,algorithm,feedback,0,127];

  // VMEM and VCED store OP6 first. The .wstone FM extension starts at OP1.
  const stride = packed ? 17 : 21;
  for (let op = 1; op <= 6; op++) {
    const start = (6 - op) * stride;
    const p = voice.subarray(start, start + stride);
    if (packed) {
      patch.push(p[15] & 1, p[15] >> 1, p[16], p[12] >> 3, p[14], p[13] >> 2);
    } else {
      patch.push(p[17], p[18], p[19], p[20], p[16], p[15]);
    }
    patch.push(...p.subarray(0, 8)); // Four envelope rates followed by four levels.
  }
  try {
    return toneFile(name, patch);
  } catch {
    throw Error(`DX7 slot ${slot} (${name}) has a parameter outside the WASWAN range`);
  }
}

export function decodeDx7(data) {
  if (data[0] !== 0xf0 || data[1] !== 0x43 || data[2] > 15 || data.at(-1) !== 0xf7)
    throw Error('Expected a Yamaha DX7 voice SysEx dump (.syx)');
  const packed = data[3] === 9;
  if (!packed && data[3] !== 0) throw Error('Unsupported DX7 SysEx format (expected 00 or 09)');
  const size = packed ? 4096 : 155;
  if (data.length !== size + 8 || data[4] !== (size >> 7) || data[5] !== (size & 127))
    throw Error('Invalid DX7 dump length');
  const payload = data.subarray(6, 6 + size);
  const checksum = data[6 + size];
  if (payload.some(byte => byte > 127) || checksum > 127) throw Error('Invalid 7-bit SysEx data');
  if ((payload.reduce((sum, byte) => sum + byte, checksum) & 127) !== 0)
    throw Error('Invalid Yamaha checksum');
  return Array.from({length: packed ? 32 : 1}, (_, i) =>
    convertVoice(packed ? payload.subarray(i * 128, (i + 1) * 128) : payload, packed, i + 1));
}

async function importBank(source, destination) {
  const input = await open(source, 'r');
  let tones;
  try {
    const info = await input.stat();
    if (!info.isFile() || info.size > 4104) throw Error('Expected a single DX7 voice or cartridge file');
    tones = decodeDx7(await input.readFile());
  } finally {
    await input.close();
  }
  await mkdir(path.dirname(destination), {recursive:true});
  // Reserve a new bank directory exclusively. A second import cannot replace it.
  await mkdir(destination);
  const created = [];
  try {
    for (const [i, tone] of tones.entries()) {
      const slug = tone.name.replace(/[^a-z0-9_-]+/gi, '-');
      const file = path.join(destination, String(i + 1).padStart(2, '0') + '-' + slug + TONE_FILE_EXTENSION);
      const output = await open(file, 'wx');
      created.push(file);
      try { await output.writeFile(JSON.stringify(tone) + '\n'); }
      finally { await output.close(); }
    }
  } catch (error) {
    for (const file of created) await unlink(file);
    await rmdir(destination);
    throw error;
  }
  console.log(`Imported ${tones.length} tone(s) into ${destination}. DX7 keyboard scaling, oscillator sync, pitch EG, LFO and transpose are omitted.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node scripts/import-dx7.mjs <voice-or-cartridge.syx> <new-bank-folder>');
    process.exitCode = 1;
  } else {
    try { await importBank(process.argv[2], process.argv[3]); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
