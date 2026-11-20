// SPDX-License-Identifier: GPL-3.0-only
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime,packSampler} from '../../web/sampler-runtime.js';
import {createInstrument,samplerLimits} from '../../web/sampler-instrument.js';

const engine=new Engine(fs.readFileSync('.local/build/waswan-256.wasm'),fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
engine.advance(3000);
const x=engine.ex,runtime=new SamplerRuntime(x);
x.waswan_mel_patch();assert(x.waswan_daw_apply(1,x.waswan_daw_token()));x.waswan_daw_taps(1);
const heapBefore=x.memory.buffer.byteLength;
const sample={id:'tone',path:'Samples/tone.wav',sha256:'1'.repeat(64),channels:2,frames:4096,sampleRate:44100};
const pcm=Int16Array.from({length:8192},(_,i)=>(Math.floor(i/16)+1)*16*(i%2?-1:1));
const base={id:'r',sample:'tone',root:60,group:'main',loop:{start:0,end:4096}};
function install(instrument){
  const ref={libraryId:'scale',instrumentId:instrument.id,revision:instrument.revision};
  const start=performance.now();const packed=packSampler(instrument);const packMs=performance.now()-start;
  const {regions,...header}=packed, incremental=regions.length>16;
  const begin=performance.now();const {token,sampleIds}=runtime.command({t:'daw-sampler-begin',request:instrument.id,ref,
    packed:incremental?{...header,regionCount:regions.length}:packed,incremental});
  const beginMs=performance.now()-begin, mapTimes=[];
  if(incremental) {
    assert.throws(()=>runtime.command({t:'daw-sampler-commit',token}),/Incomplete sampler map/);
    for(let offset=0;offset<regions.length;offset+=16){
      const rows=regions.slice(offset,offset+16);
      const started=performance.now();
      assert.equal(runtime.command({t:'daw-sampler-map',token,offset,rows}),offset+rows.length);
      mapTimes.push(performance.now()-started);
    }
  }
  for(const id of sampleIds)runtime.command({t:'daw-sampler-chunk',token,sampleId:id,offset:0,pcm});
  runtime.command({t:'daw-sampler-commit',token});
  runtime.applySlots(runtime.prepareSlots([{...ref,type:'sampler',trackId:'A',part:0}]));
  return {packMs,beginMs,mapBlocks:mapTimes.length,mapTotalMs:mapTimes.reduce((a,b)=>a+b,0),mapMaxMs:Math.max(0,...mapTimes),sampleUploads:sampleIds.length,heapBytes:x.memory.buffer.byteLength};
}
const small=install(createInstrument({id:'single',revision:1,samples:[sample],regions:[base]}));
const variations=Array.from({length:64},(_,set)=>({id:'s'+set,order:Array.from({length:8},(_,n)=>'t'+n),mode:'sequential'}));
const regions=variations.flatMap((v,n)=>v.order.map((member,take)=>{
  const start=(n*8+take)*8,end=start+8;
  return {...base,id:v.id+member,group:'g'+n,key:[n,n],root:n,frames:[start,end],loop:{start,end},variation:{set:v.id,member}};
}));
const model=createInstrument({id:'large',revision:1,samples:[sample],regions,variations,groups:variations.map((_,n)=>({id:'g'+n}))});
const large=install(model);
assert.equal(large.sampleUploads,0);
const selected=new Set();
for(let n=0;n<64;n++)for(let take=0;take<8;take++){
  const id=n*8+take+1;
  assert(x.waswan_sampler_note_id(0,n,100,0,id));
  const indices=[];for(let i=0;i<256;i++){const index=x.waswan_sampler_voice_region(i);if(index)indices.push(index);}
  assert.deepEqual(indices,[id]);selected.add(id);
  for(let block=0;block<4;block++)engine.render(128);
  for(let channel=0;channel<2;channel++){
    const values=new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,channel),128);
    assert.equal(values[127],id*16/32768*(channel?-1:1),'Stereo PCM identifies selected slice '+id);
  }
  x.waswan_daw_stop(1);
}
assert.equal(selected.size,512);
assert.throws(()=>packSampler({...model,regions:[...regions,{...regions[0],id:'oneTooMany'}]}),error=>error.code==='budget-exceeded');
assert.throws(()=>packSampler({...model,variations:[...variations,{...variations[0],id:'oneTooMany'}]}),error=>error.code==='budget-exceeded');
assert.throws(()=>packSampler({...model,groups:Array.from({length:129},(_,n)=>({id:'g'+n}))}),error=>error.code==='budget-exceeded');
const overlay=createInstrument({id:'overlay',revision:1,samples:[sample],regions:regions.map((_,i)=>({...base,id:'r'+i}))});
install(overlay);assert(x.waswan_sampler_note_id(0,60,100,0,1));
const voices=Array.from({length:256},(_,i)=>x.waswan_sampler_voice_region(i)).sort((a,b)=>a-b);
assert.deepEqual(voices,Array.from({length:256},(_,i)=>i+1),'One saturated attack takes its first 256 eligible regions');
x.waswan_daw_stop(1);
console.log(JSON.stringify({heapBefore,small,large,visited:selected.size,limits:samplerLimits},null,2));

// Drive the control-side upload, including transferable (detached) map buffers,
// through a real filesystem library and the same runtime used by the worklet.
const {prepareSampler}=await import('../../web/sampler.js');
const {initializeLibrary,importOriginal,publish}=await import('../../web/sampler-library.js');
const {diskDirectory}=await import('./filesystem.mjs');
const {pcmWav}=await import('./fixtures.mjs');
const {tmpdir}=await import('node:os');
const {join}=await import('node:path');
const folder=fs.mkdtempSync(join(tmpdir(),'waswan-large-sampler-'));
try {
  const root=await diskDirectory(folder);
  await initializeLibrary(root,{id:'bulk-disk',name:'Bulk disk'});
  const file=await importOriginal(root,pcmWav(pcm,{channels:2}),'Samples/Originals/scale.wav',{id:'tone'});
  const ref=await publish(root,{...model,id:'physical-large',revision:0,samples:[file]},
    {path:'Instruments/Scale',expectedRevision:0});
  let batches=0,interrupt=true;
  const controller=new AbortController();
  const player={requests:()=>({request:async(t,data={},transfer=[])=>{
    if(t==='daw-sampler-patch')return {patch:Array(80).fill(0)};
    const cloned=structuredClone(data,{transfer});
    const result=runtime.command({t,request:crypto.randomUUID(),...cloned});
    if(t==='daw-sampler-map'){
      batches++;assert(transfer.every(buffer=>buffer.byteLength===0));
      if(interrupt)controller.abort();
    }
    return result;
  }})};
  await assert.rejects(prepareSampler(player,root,ref,{signal:controller.signal}),{name:'AbortError'});
  assert.equal(batches,1);
  assert.equal(runtime.command({t:'daw-sampler-status',ref}).resident,false);
  interrupt=false;batches=0;
  const loaded=await prepareSampler(player,root,ref);
  assert.equal(loaded.instrumentId,ref.instrumentId);
  assert.equal(batches,32);
  assert.equal(runtime.command({t:'daw-sampler-status',ref}).resident,true);
  console.log('PASS 32 acknowledged transferable map batches, cancelled partial preparation, and retry through the library API.');
} finally { fs.rmSync(folder,{recursive:true,force:true}); }
