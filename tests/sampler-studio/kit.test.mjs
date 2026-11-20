// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeLibrary,importOriginal,publish,load,collect,verify} from '../../web/sampler-library.js';
import {createKit,kitFromSlices} from '../../web/sampler-kit.js';
import {compile,explainNote} from '../../web/sampler-instrument.js';
import {diskDirectory} from './filesystem.mjs';
import {pcmWav} from './fixtures.mjs';
import {renderKitDemonstration} from './kit-performance.mjs';

const dir=await mkdtemp(join(tmpdir(),'waswan-drumkit-'));
try{
  const folder=process.argv[2]??join(dir,'library');await mkdir(folder,{recursive:true});
  const root=await diskDirectory(folder);
  await initializeLibrary(root);
  const samples=[];
  for(const [name,hz,decay] of [['kick',80,12],['rim',417,42],['snare-a',272,20],['snare-b',303,20],['open',1970,4],['closed',2230,59]]){
    const pcm=Int16Array.from({length:18000},(_,i)=>Math.round(9800*Math.exp(-i*decay/44100)*
      (Math.sin(i*2*Math.PI*hz/44100)+.3*Math.sin(i*2*Math.PI*hz*2.41/44100))));
    samples.push(await importOriginal(root,pcmWav(pcm,{channels:1}),'Samples/Originals/Percussion/'+name+'.wav',{id:name,provenance:'Synthesized test percussion'}));
  }
  const pads=Array.from({length:16},(_,i)=>({index:i+1,note:36+i,recordings:[{sample:i%2?'rim':'kick'}]}));
  pads[2].recordings=['a','b'].map(member=>({sample:'snare-'+member,variation:{set:'snare',member}}));
  pads[4]={index:5,note:40,choke:'hats',recordings:[{sample:'open',root:75}]};
  pads[5]={index:6,note:41,choke:'hats',recordings:[{sample:'closed'}]};
  const kit=createKit({id:'kitchen',name:'Test percussion',pads,samples,variations:[{id:'snare',mode:'sequential',order:['a','b']}]});
  const plan=compile(kit);
  for(const pad of kit.pads)assert.equal(explainNote(plan,{type:'noteOn',note:pad.note,velocity:90}).voices.length,1);
  const first=explainNote(plan,{type:'noteOn',note:38,velocity:100});const second=explainNote(plan,{type:'noteOn',note:38,velocity:110},first.state);
  assert.notEqual(first.voices[0].regionId,second.voices[0].regionId);
  assert.throws(()=>createKit({name:'Bad',samples,pads:[pads[0],pads[0]]}));
  const slices=kitFromSlices(samples[2],[3000,6000],{firstNote:42});
  assert.deepEqual(slices.regions.map(r=>r.frames),[[0,3000],[3000,6000],[6000,18000]]);
  const ref=await publish(root,kit,{path:'Kits/Test percussion',expectedRevision:0});
  await mkdir(join(dir,'portable'));
  const copy=await diskDirectory(join(dir,'portable'));
  const external=await collect(root,ref,copy);
  assert((await verify(copy,external)).ok);
  assert.deepEqual((await load(copy,external)).pads,kit.pads);
  await renderKitDemonstration(copy,external);
  console.log('PASS 16 MIDI pads, independent pitch, snare variations, slices and portable physical kit',ref);
}finally{await rm(dir,{recursive:true,force:true});}
