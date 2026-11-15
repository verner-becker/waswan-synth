// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {MidiProfile,STORAGE_KEY} from '../web/midi-profile.js';
import {Engine} from '../.local/www/simulator/engine.js';
const port='Synthetic knobs',messages=[];
let saved=JSON.stringify({version:1,enabled:true,bindings:[{port,channel:0,cc:48,target:'enc:0',mode:'absolute'}]});
const storage={getItem:()=>saved,setItem:(k,v)=>{assert.equal(k,STORAGE_KEY);saved=v;}};
const p=new MidiProfile(storage),cc=v=>p.handle([0xb0,48,v],port,m=>messages.push(m));
assert.equal(p.bindings[0].behavior,'normal');cc(40);cc(41);assert.deepEqual(messages.pop(),{t:'enc',e:0,steps:1});
assert(p.setBehavior('enc:0','fine'));p.setContext(123);cc(80);assert.equal(messages.length,0);cc(81);assert.deepEqual(messages.pop(),{t:'enc-fine',e:0,steps:1,context:123});
cc(83);assert.equal(messages.pop().steps,2);cc(80);assert.equal(messages.pop().steps,-3);cc(127);assert.equal(messages.pop().steps,47);cc(0);assert.equal(messages.pop().steps,-127);
p.setContext(124);cc(100);assert.equal(messages.length,0);cc(101);assert.equal(messages.pop().steps,1);
p.reset();p.setContext(124);cc(10);assert.equal(messages.length,0);cc(9);assert.equal(messages.pop().steps,-1);
assert.equal(new MidiProfile(storage).bindings[0].behavior,'fine');assert.equal(p.learn('enc:4','absolute','fine'),false);assert.equal(p.learn('fader:0','absolute','fine'),false);
for(const [mode,up,down,neutral,jump] of [['offset',65,63,64,67],['twos',1,127,0,3]]){
 p.learn('enc:0',mode,'fine');cc(neutral);cc(up);assert.equal(messages.pop().steps,1);cc(down);assert.equal(messages.pop().steps,-1);cc(neutral);assert.equal(messages.length,0);cc(jump);assert.equal(messages.pop().steps,3);cc(mode==='offset'?127:64);assert.equal(messages.pop().steps,mode==='offset'?63:-64);
}
p.learn('enc:0','absolute','fine');cc(0);for(let v=1;v<=127;v++){cc(v);assert.equal(messages.pop().steps,1);}for(let v=126;v>=0;v--){cc(v);assert.equal(messages.pop().steps,-1);}cc(0);assert.equal(messages.length,0);
assert.equal(p.handle([0x90,60,100],port,()=>{}),false);assert.equal(p.handle([0xe0,0,80],port,()=>{}),false);assert.equal(p.handle([0xb0,64,127],port,()=>{}),false);
p.learn('fader:0','absolute');p.handle([0xb0,49,0],port,()=>{});p.handle([0xb0,49,127],port,m=>messages.push(m));assert.deepEqual(messages.pop(),{t:'fader',f:0,v:127});
// Native host adapter and original encoder path, real 256-voice WASM.
const wasm=fs.readFileSync('.local/build/waswan-256.wasm'),seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
function fixture(){const e=new Engine(wasm,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));e.advance(5000);return e;}
const ctx=e=>e.ex.waswan_knob_context()>>>0;
function setCut(e,v){e.input({t:'midi',st:0xb0,d1:74,d2:v});e.advance(30);assert.equal(e.ex.sim_param(0,e.ex.waswan_knob_param(0)),v);}
const results=[];
for(const delta of [1,2,3,-1,-2,-3]){
 const normal=fixture(),fine=fixture();setCut(normal,40);setCut(fine,40);const param=fine.ex.waswan_knob_param(0);
 normal.input({t:'enc',e:0,steps:delta});normal.advance(30);
 fine.input({t:'enc-fine',e:0,steps:delta,context:ctx(fine)});fine.advance(30);
 const n=normal.ex.sim_param(0,param),f=fine.ex.sim_param(0,param);assert.equal(n,40+delta*(Math.abs(delta)>1?6:2));assert.equal(f,40+delta);results.push({start:40,delta,normal:n,fine:f});
}
const e=fixture();setCut(e,40);const param=e.ex.waswan_knob_param(0),context=ctx(e);
for(let i=0;i<100;i++)e.input({t:'enc-fine',e:0,steps:1,context});assert.equal(e.ex.sim_param(0,param),127);
for(let i=0;i<200;i++)e.input({t:'enc-fine',e:0,steps:-1,context});assert.equal(e.ex.sim_param(0,param),0);
setCut(e,40);for(const bad of [null,context+1,-1,2**32])e.input({t:'enc-fine',e:0,steps:1,context:bad});assert.equal(e.ex.sim_param(0,param),40);
for(const steps of [128,-128,1.5,NaN])e.input({t:'enc-fine',e:0,steps,context});assert.equal(e.ex.sim_param(0,param),40);
// Page button PARA (13), preset recall, and queued navigation reject stale deltas.
const tap=(e,b)=>{e.input({t:'btn',b,down:true});e.advance(80);e.input({t:'btn',b,down:false});e.advance(150);};
e.input({t:'enc',e:6,steps:1});e.input({t:'enc-fine',e:0,steps:50,context});assert.equal(e.ex.sim_param(0,param),40);e.advance(100);
assert.notEqual(ctx(e),context);const newValue=e.ex.sim_param(0,param);e.input({t:'enc-fine',e:0,steps:50,context});assert.equal(e.ex.sim_param(0,param),newValue);
const signedStep=newValue>0?-1:1;e.input({t:'enc-fine',e:0,steps:signedStep,context:ctx(e)});assert.equal(e.ex.sim_param(0,param),newValue+signedStep,'uint32 context works with high bit set');
const old=ctx(e);tap(e,13);assert.notEqual(ctx(e),old);const id=e.ex.waswan_knob_param(0);if(id>=0){const before=e.ex.sim_param(0,id);e.input({t:'enc-fine',e:0,steps:1,context:old});assert.equal(e.ex.sim_param(0,id),before);}
const global=fixture();tap(global,10);assert.equal(global.ex.waswan_knob_param(0),-1);assert.equal(global.ex.waswan_knob_fine(0,1,ctx(global)),0);
const pending=fixture();setCut(pending,40);pending.input({t:'midi',st:0xc0,d1:70,d2:0});pending.input({t:'enc-fine',e:0,steps:10,context:ctx(pending)});assert.equal(pending.ex.sim_param(0,param),40);
const pad=fixture();setCut(pad,40);pad.input({t:'pad',p:7,v:100});pad.input({t:'enc-fine',e:0,steps:10,context:ctx(pad)});assert.equal(pad.ex.sim_param(0,param),40);
// Bit-for-bit no-edit audio against preserved DSP Monitor base; storage format and initial parameters unchanged.
if(!fs.existsSync('.local/validation/knob-base-256.wasm'))execFileSync('sh',['tests/build-knob-reference.sh'],{stdio:'inherit'});
const oldWasm=fs.readFileSync('.local/validation/knob-base-256.wasm');
const baseline=new Engine(oldWasm,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength)),changed=new Engine(wasm,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));
for(const x of [baseline,changed]){x.advance(5000);x.input({t:'voice-mode',part:0,mode:0});for(const n of [48,52,55,60,64,67,72,76])x.input({t:'midi',st:0x90,d1:n,d2:100});}
assert.equal(baseline.ex.waswan_voice_limit(),256);assert.equal(baseline.ex.waswan_knob_fine,undefined);
assert.equal(baseline.ex.sim_blob_count(),changed.ex.sim_blob_count());assert.equal(baseline.ex.sim_blob_size(),changed.ex.sim_blob_size());
for(let b=0;b<500;b++){for(const x of [baseline,changed])x.render(128);for(const out of ['sim_out_l','sim_out_r'])assert.deepEqual(new Float32Array(changed.ex.memory.buffer,changed.ex[out](),128),new Float32Array(baseline.ex.memory.buffer,baseline.ex[out](),128));}
for(let t=0;t<4;t++)for(let i=0;i<changed.ex.waswan_parameter_count();i++)assert.equal(changed.ex.sim_param(t,i),baseline.ex.sim_param(t,i));
const sameNormal=fixture(),sameFine=fixture();setCut(sameNormal,40);setCut(sameFine,40);sameNormal.input({t:'enc',e:0,steps:1});sameNormal.advance(30);sameFine.input({t:'enc-fine',e:0,steps:2,context:ctx(sameFine)});sameFine.advance(30);
for(const x of [sameNormal,sameFine])x.input({t:'midi',st:0x90,d1:60,d2:100});
for(let b=0;b<200;b++){for(const x of [sameNormal,sameFine])x.render(128);for(const out of ['sim_out_l','sim_out_r'])assert.deepEqual(new Float32Array(sameFine.ex.memory.buffer,sameFine.ex[out](),128),new Float32Array(sameNormal.ex.memory.buffer,sameNormal.ex[out](),128));}
fs.writeFileSync('.local/validation/knob-fine-native.json',JSON.stringify({result:'PASS',results,fastTurns:true,limits:[0,127],staleContext:true,queuedNavigation:true,legacyProfile:true,audio:'128000 scalar samples identical to DSP Monitor base'},null,2));console.log('PASS knob fine:',JSON.stringify(results));
