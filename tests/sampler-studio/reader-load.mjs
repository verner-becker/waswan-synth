// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime} from '../../web/sampler-runtime.js';
import {createInstrument} from '../../web/sampler-instrument.js';
const engine=new Engine(fs.readFileSync('.local/build/waswan-256.wasm'),fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
engine.advance(3000);
const x=engine.ex, runtime=new SamplerRuntime(x);
x.waswan_mel_patch();assert(x.waswan_daw_apply(1,x.waswan_daw_token()));
const sample={id:'wave',path:'Samples/wave.wav',sha256:'b'.repeat(64),channels:2,frames:4096,sampleRate:44100};
const data=Int16Array.from({length:8192},(_,i)=>Math.sin(i/45)*512);
const reports=[];
for (const [name,notes,layers] of [['root',60,1],['fifth',67,1],['layers',67,2]]) {
  const ref={libraryId:'measure',instrumentId:name,revision:1};
  const instrument=createInstrument({id:name,revision:1,samples:[sample],regions:Array.from({length:layers},(_,i)=>({
    id:'layer'+i,group:'main',sample:'wave',root:60,loop:{start:0,end:4096}}))});
  const {token,sampleIds}=runtime.command({t:'daw-sampler-begin',request:name,ref,instrument});
  for(const sampleId of sampleIds)runtime.command({t:'daw-sampler-chunk',token,sampleId,offset:0,pcm:data});
  runtime.command({t:'daw-sampler-commit',token});
  runtime.applySlots(runtime.prepareSlots([{...ref,type:'sampler',part:0,trackId:'A'}]));
  for(let id=1;id<=48;id++)assert(x.waswan_sampler_note_id(0,notes,100,0,id));
  for(let i=0;i<96;i++)engine.render(128);
  const times=[];for(let i=0;i<512;i++){const start=performance.now();engine.render(128);times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);reports.push({name,voices:48*layers,p50Ms:times[256],p95Ms:times[486],p99Ms:times[506],maxMs:times[511]});
  x.waswan_daw_stop(1);
}
console.log(JSON.stringify(reports,null,2));
