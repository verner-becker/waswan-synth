// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diskDirectory} from './filesystem.mjs';
import {pcmWav} from './fixtures.mjs';
import {initializeLibrary,importOriginal,listChildren,search} from '../../web/sampler-library.js';

const dir = await mkdtemp(join(tmpdir(),'waswan-catalog-'));
try {
  const root = await diskDirectory(dir);
  await initializeLibrary(root);
  const file = pcmWav(Int16Array.of(0,100,-30,25),{channels:1});
  for (let folder=0; folder<12; folder++) {
    for (let index=0; index<32; index++) {
      const name = 'Sound-'+String(index+1).padStart(2,'0')+'.wav';
      await importOriginal(root,file,'Samples/Originals/Set-'+folder+'/'+name);
    }
  }
  const fresh = await diskDirectory(dir);
  const start = performance.now();
  const page = await listChildren(fresh,'Samples/Originals/Set-0',{limit:16});
  assert.equal(page.items.length,16);
  const next = await listChildren(fresh,'Samples/Originals/Set-0',{cursor:page.nextCursor,limit:16});
  assert.equal(next.nextCursor,null);
  assert.equal(new Set([...page.items,...next.items].map(x=>x.path)).size,32);
  const pagesMs = performance.now()-start;
  const lookup = performance.now();
  const found = await search(fresh,{text:'Sound-17',kind:'sample'});
  assert.equal(found.items.length,12);
  const metrics = {entries:384,folderPages:2,pagesMs,searchMs:performance.now()-lookup};
  const out = process.env.SAMPLER_VALIDATION_ROOT || '.local/validation/sampler-studio-5';
  await mkdir(out,{recursive:true});
  await writeFile(join(out,'catalog.json'),JSON.stringify(metrics,null,2));
  console.log('PASS cold disk catalog',JSON.stringify(metrics));
} finally {await rm(dir,{recursive:true,force:true});}
