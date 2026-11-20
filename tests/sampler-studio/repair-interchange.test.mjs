// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,rename,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diskDirectory} from './filesystem.mjs';
import {pcmWav} from './fixtures.mjs';
import {initializeLibrary,importOriginal,publish,relinkMatches,load,verify,findCandidates} from '../../web/sampler-library.js';
import {createInstrument} from '../../web/sampler-instrument.js';
import {importSfz} from '../../web/sampler-sfz.js';

const folder=await mkdtemp(join(tmpdir(),'sampler-relink-set-'));
try{
  const root=await diskDirectory(folder);
  await initializeLibrary(root);
  const samples=[];
  for(const [id,power] of [['a',300],['b',800]]){
    const wav=pcmWav(new Int16Array(1200).fill(power),{channels:1});
    samples.push(await importOriginal(root,wav,'Samples/Originals/'+id+'.wav',{id}));
  }
  const map=createInstrument({name:'Two takes',samples,regions:samples.map((s,i)=>({
    id:'r'+i,root:60,key:[60+i,60+i],group:'main',sample:s.id}))});
  const ref=await publish(root,map,{path:'Instruments/Two takes',expectedRevision:0});
  const moves=new Map();
  await mkdir(join(folder,'Samples/Recovered'));
  for(const s of samples){
    const path='Samples/Recovered/'+s.id+'.wav';
    await rename(join(folder,s.path),join(folder,path));
    const found=await findCandidates(root,s);
    assert.equal(found.status,'candidate-found');assert.equal(found.candidates[0].path,path);moves.set(s.id,path);
  }
  await assert.rejects(relinkMatches(root,ref,new Map([['a',moves.get('b')],['b',moves.get('a')]])),{code:'digest-mismatch'});
  const updated=await relinkMatches(root,ref,moves);
  assert.equal(updated.revision,2);assert((await verify(root,updated)).ok);assert(!(await verify(root,ref)).ok);
  assert.deepEqual((await load(root,updated)).samples.map(s=>s.sha256),samples.map(s=>s.sha256));
  await assert.rejects(relinkMatches(root,ref,moves),{code:'revision-conflict'});

  const maps=await root.getDirectoryHandle('SFZ',{create:true});
  await writeFile(join(folder,'SFZ/source.wav'),await readFile(join(folder,moves.get('a'))));
  const options={id:'import',path:'Instruments/SFZ'};
  await assert.rejects(importSfz(root,maps,'<region> sample=source.wav key=60',
    {...options,beforePublish:()=>{throw Error('Host is busy');}}),/Host is busy/);
  await assert.rejects(readFile(join(folder,options.path,'instrument.json')),{code:'ENOENT'});
  const imported=await importSfz(root,maps,'<region> sample=source.wav key=60',options);
  assert((await verify(root,imported.ref)).ok);
  console.log('PASS physical two-file repair is atomic, detects stale revisions and incorrect hashes, SFZ preflight failure preserves official pointer');
}finally{await rm(folder,{recursive:true,force:true});}
