// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Run against the reopened mixed session. Its exact sampler revision and tape
// pair have already been restored into the shared host by the DAW.
export async function printMixedFusion(page,evidence) {
  const {prints,encoded}=await page.evaluate(async()=>{
    const {captureFusion}=await import('./sampler-fusion.js');
    const {readSampleFile}=await import('./sampler-library.js');
    const w=audit.w,root=await audit.directory('Relocated library');
    const sources=w.snapshot.tracks.map(track=>({id:track.id,name:track.name,instrument:track.instrument,volume:.25}));
    const options={name:'WASWAN hybrid',duration:.30,release:.12,notes:[60],velocities:[100]};
    const prints=[];
    for(const source of sources){
      const {report}=await captureFusion(w,root,[source],options);
      prints.push({source:source.name,peak:report.peak});
    }
    const {draft,report}=await captureFusion(w,root,sources,options);
    prints.push({source:'Combined',peak:report.peak,sources:draft.source.provenance.fusion.sources.map(s=>s.name)});
    return {prints,encoded:await audit.base64(await readSampleFile(root,draft.source))};
  });
  assert(prints.every(t=>t.peak>.001&&t.peak<1),JSON.stringify(prints));
  assert.deepEqual(prints.at(-1).sources,['Analog','FM','Mellotron','Sampler']);
  await writeFile(join(evidence,'four-engine-fusion.wav'),Buffer.from(encoded,'base64'));
  await writeFile(join(evidence,'four-engine-fusion.json'),JSON.stringify(prints,null,2));
  return prints;
}
