// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Engine} from '../../.local/www/simulator/engine.js';
import {TapeRuntime} from '../../web/mellotron-runtime.js';
import {tapeDefaults} from '../../web/mellotron-settings.js';
import {amplitude} from '../mellotron-a/fixture.mjs';

const dir='.local/validation/mellotron-b';fs.mkdirSync(dir,{recursive:true});
const e=new Engine(fs.readFileSync('.local/www/simulator/obervave-voice.wasm'),fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
e.advance(5000);
const x=e.ex,runtime=new TapeRuntime(x),heapBefore=x.memory.buffer.byteLength;
const tape={id:'a'.repeat(64),banks:['Two pitches','Overtone'],settings:{...tapeDefaults(),attack:1,release:3,mix:0}};
const regions=[0,1].map(bank=>{
  const pcm=new Int16Array(44100);
  for(let i=0;i<pcm.length;i++){
    const hz=bank?880:i>19000?440:220;
    pcm[i]=10000*Math.sin(2*Math.PI*i*hz/44100);
  }
  return {root:60,bank,pcm,frames:pcm.length};
});
function install(){
  const token=runtime.command({t:'daw-tape-begin',request:'pair',regions});
  let offset=0;
  for(const r of regions)for(let i=0;i<r.frames;i+=32768){
    const pcm=r.pcm.slice(i,i+32768);
    runtime.command({t:'daw-tape-chunk',token,pcm,offset});offset+=pcm.length;
  }
  runtime.command({t:'daw-tape-commit',token,tape});
}
assert(x.waswan_mel_patch());
const neutral=new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer(),80);
neutral[38]=0;neutral[39]=1;neutral[42]=neutral[43]=neutral[47]=0;
assert(x.waswan_daw_apply(1,x.waswan_daw_token()));
install();x.waswan_daw_taps(1);
e.input({t:'voice-mode',part:0,mode:0});
const note=(on,n=60,velocity=100)=>e.input({t:'midi',st:on?144:128,d1:n,d2:on?velocity:0});
const settings=changes=>runtime.command({t:'daw-tape-live',enabled:true,settings:{...tape.settings,...changes}});
function capture(){
  const pcm=new Float32Array(8192*2);
  for(let i=0;i<8192;i+=128){
    e.render(128);const samples=new Float32Array(x.memory.buffer,x.waswan_daw_output(0,0),128);
    for(let j=0;j<128;j++)pcm[2*(i+j)]=samples[j];
  }
  return pcm;
}
const level=(block,hz)=>amplitude(block,0,8192,hz);
function dominant(hz,other){const block=capture();assert(level(block,hz)>8*Math.max(.00001,level(block,other)),String(hz));}
note(true);e.advance(20);dominant(220,440);
assert.throws(install,/Release keys/); // staging a replacement keeps the active pair intact
e.advance(330);note(false);e.advance(6);note(true);dominant(440,220);
note(false);e.advance(200);note(true);dominant(220,440);
settings({mix:100});dominant(880,220);
settings({mix:50,loop:1});const mix=capture();
assert(level(mix,880)>.001 && Math.max(level(mix,220),level(mix,440))>.001);
e.advance(1600);assert(level(capture(),880)>.001);
note(false);e.advance(300);
settings({mix:100,transpose:12});note(true);dominant(1760,880);note(false);e.advance(300);
settings({mix:100,loop:1});
note(true);e.advance(20);
e.input({t:'midi',st:176,d1:64,d2:127});note(false);e.advance(50);
assert(e.frame().polyphony.slots.some(v=>v.gate),'pedal holds the tape');
e.input({t:'midi',st:224,d1:127,d2:127});e.advance(150);
const bent=capture();
assert(level(bent,880)<.001,'bend moves the tape away from its nominal pitch');
e.input({t:'midi',st:224,d1:0,d2:64});e.input({t:'midi',st:176,d1:64,d2:0});e.advance(300);
assert(!e.frame().polyphony.slots.some(v=>v.active),'pedal up releases the tape');
function strike(velocity){note(true,60,velocity);e.advance(25);const amp=level(capture(),880);note(false);e.advance(300);return amp;}
const fixedRatio=strike(110)/strike(35);assert(Math.abs(fixedRatio-1)<.05,'Fixed velocity ratio '+fixedRatio);
settings({mix:100,loop:1,velocity:1});
assert(strike(110)>2.7*strike(35));
settings({mix:50,loop:1,wow:30,flutter:20,wear:10,drive:15});
for(let i=0;i<12;i++)note(true,60+i);
e.advance(100);assert.equal(e.frame().polyphony.slots.filter(v=>v.gate).length,12);
const times=[];
for(let i=0;i<2048;i++){const start=performance.now();e.render(128);times.push(performance.now()-start);}
times.sort((a,b)=>a-b);
e.input({t:'panic'});e.advance(1200);
assert.equal(e.frame().polyphony.slots.filter(v=>v.active).length,0);
assert.equal(x.waswan_voice_limit(),256);
for(const r of regions){
  const second=r.pcm;
  r.pcm=new Int16Array(8*44100);
  for(let n=0;n<8;n++)r.pcm.set(second,n*44100);
  r.frames=r.pcm.length;
}
install();settings({mix:100});note(true);e.advance(7650);
dominant(880,220);e.advance(240);
assert(capture().every(v=>v===0),'eight-second tape stops at its end');
note(false);e.advance(1500);
const report={fixedRatio,voices:12,heads:24,blocks:2048,meanMs:times.reduce((a,b)=>a+b)/times.length,p99Ms:times[Math.floor(times.length*.99)],heapBefore,heapAfterFirstAndStagedSwap:x.memory.buffer.byteLength};
fs.writeFileSync(dir+'/host.json',JSON.stringify(report,null,2));console.log(report);
