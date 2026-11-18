// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
const wasm=fs.readFileSync('.local/build/waswan-256.wasm'),seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
function fixture(taps){
  const e=new Engine(wasm,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));e.advance(5000);
  for(let p=0;p<4;p++)e.input({t:'voice-mode',part:p,mode:0});
  e.ex.waswan_daw_taps(taps?1:0);return e;
}
const output=(e,p,c,n)=>new Float32Array(e.ex.memory.buffer,e.ex.waswan_daw_output(p,c),n).slice();
const stereo=(e,n)=>[e.ex.sim_out_l(),e.ex.sim_out_r()].map(ptr=>new Float32Array(e.ex.memory.buffer,ptr,n).slice());
const energy=a=>a.reduce((s,v)=>s+Math.abs(v),0);
const enabled=fixture(true),disabled=fixture(false);
for(const e of [enabled,disabled])assert(e.ex.waswan_studio_note(0,60,100));
let dryEnergy=0;
for(let k=0;k<100;k++){
  const n=[1,127,128,129,255,256,513,1024][k%8];
  enabled.render(n);disabled.render(n);
  assert.deepEqual(stereo(enabled,n),stereo(disabled,n),'tap must not change Legacy output');
  dryEnergy+=energy(output(enabled,0,0,n));
  for(let p=1;p<4;p++)for(let c=0;c<2;c++)assert.equal(energy(output(enabled,p,c,n)),0,'unplayed part stays silent');
}
assert(dryEnergy>0);
const normal=fixture(true),muted=fixture(true);
muted.ex.waswan_studio_mix_set(0,0,0);
for(const e of [normal,muted])e.ex.waswan_studio_note(0,60,100);
for(let k=0;k<20;k++){
  for(const e of [normal,muted])e.render(128);
  for(let c=0;c<2;c++)assert.deepEqual(output(normal,0,c,128),output(muted,0,c,128),'dry tap precedes part mixer');
}
const whole=fixture(true),chunked=fixture(true);
for(const e of [whole,chunked]){e.ex.waswan_studio_note(0,60,100);e.ex.waswan_studio_note(1,67,95);}
for(let block=0;block<24;block++){
  whole.render(1024);
  const a=[[],[]],b=[[],[]];
  for(const n of [1,127,129,255,128,256,128]){
    chunked.render(n);
    for(let c=0;c<2;c++){a[c].push(...output(chunked,0,c,n));b[c].push(...output(chunked,1,c,n));}
  }
  for(let c=0;c<2;c++){
    assert.deepEqual(new Float32Array(a[c]),output(whole,0,c,1024),'dry A alignment across ISR boundaries');
    assert.deepEqual(new Float32Array(b[c]),output(whole,1,c,1024),'dry B alignment across ISR boundaries');
  }
}
assert.equal(whole.ex.waswan_voice_limit(),256);
assert.equal(whole.ex.waswan_daw_output(whole.ex.waswan_daw_output_count(),0),0);
console.log('PASS dry outputs: final stereo bit-identical, part isolation, pre-mixer tap, variable render boundaries, 256 pool preserved');
