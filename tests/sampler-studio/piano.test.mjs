// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime} from '../../web/sampler-runtime.js';
import {prepareSampler} from '../../web/sampler.js';
import {toneBytes} from '../../web/fm-patch.js';
import {diskDirectory} from './filesystem.mjs';
import {createSamplerFixtures,pcmWav} from './fixtures.mjs';

const dir=await mkdtemp(join(tmpdir(),'waswan-playable-piano-'));
try {
  const root=await diskDirectory(dir),{piano}=await createSamplerFixtures(root);
  const e=new Engine(await readFile('.local/build/waswan-256.wasm'),await readFile('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
  e.advance(4000);
  const x=e.ex,runtime=new SamplerRuntime(x);
  const rpc={async request(t,data){if(t==='daw-sampler-patch'){assert(x.waswan_mel_patch());return {patch:toneBytes(x,0,true)};}
    return runtime.command({...data,t,request:crypto.randomUUID()});}};
  const instrument=await prepareSampler({requests:()=>rpc},root,piano);
  assert(x.waswan_daw_apply(1,x.waswan_daw_token()));x.waswan_daw_taps(1);
  runtime.applySlots(runtime.prepareSlots([{...instrument,part:0,trackId:'demo'}]));
  const pcm=[],note=(key,vel)=>assert(x.waswan_daw_note(0,key,vel));
  function capture(blocks){
    let energy=0;
    for(let i=0;i<blocks;i++){
      e.render(128);
      const left=new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,0),128);
      const right=new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,1),128);
      for(let j=0;j<128;j++){pcm.push(Math.round(32767*left[j]),Math.round(32767*right[j]));energy+=left[j]**2+right[j]**2;}
    }
    return energy;
  }
  for(const [key,vel] of [[48,38],[60,72],[60,72],[72,113]]){
    note(key,vel);assert(capture(76)>1);note(key,0);assert(capture(40)>0);
  }
  note(25,100);note(25,0);
  for(const key of [60,64,67])note(key,90);
  assert(capture(100)>1);
  for(const key of [60,64,67])note(key,0);
  capture(80);
  const output='.local/validation/sampler-studio-1';
  await mkdir(output,{recursive:true});
  await writeFile(output+'/piano-demo.wav',pcmWav(pcm));
  console.log('PASS played physical three-root piano, velocity layers, repeated strike, articulation and release through host; piano-demo.wav');
} finally {await rm(dir,{recursive:true,force:true});}
