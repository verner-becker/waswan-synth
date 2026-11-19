// SPDX-License-Identifier: GPL-3.0-only
import {toneFile, saveToneFile} from './tone-bank.js';

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

export async function writeDx7Bank(directory, tones, newFolder) {
  if (directory.requestPermission && await directory.requestPermission({mode:'readwrite'}) !== 'granted')
    throw Error('Write access to the bank folder was denied.');
  const write = async () => {
    let target = directory;
    if (newFolder) {
      try {
        await directory.getDirectoryHandle(newFolder);
        throw Error('This bank already exists. Select it from the list to add tones.');
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
      target = await directory.getDirectoryHandle(newFolder, {create:true});
    }
    const created = [];
    try {
      for (const [i, tone] of tones.entries())
        created.push(await saveToneFile(target, tone.name, tone.patch, i + 1));
    } catch (error) {
      try {
        for (const file of created) await target.removeEntry(file);
        if (newFolder) await directory.removeEntry(newFolder);
      } catch {
        throw Error(`Import interrupted. Check “${target.name}” for partial files before retrying. ${error.message}`);
      }
      throw error;
    }
    return {target, first:created[0]};
  };
  // Directory creation has no exclusive flag. Serialize the lookup and creation
  // across WASWAN tabs; writes into existing banks already use unique filenames.
  return newFolder ? navigator.locks.request('waswan-dx7-new-bank', write) : write();
}
