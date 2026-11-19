// SPDX-License-Identifier: GPL-3.0-only
import {mkdir, open, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TONE_FILE_EXTENSION} from '../web/tone-bank.js';
import {decodeDx7} from '../web/fm-dx7.js';

export {decodeDx7};

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
