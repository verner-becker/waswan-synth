// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime,packSampler} from '../../web/sampler-runtime.js';
import {createInstrument} from '../../web/sampler-instrument.js';

const wasm=readFileSync('.local/build/waswan-256.wasm');
const session=readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
const ref={libraryId:'fx-test',instrumentId:'tone',revision:1};
const sample={id:'tone',path:'Samples/tone.wav',sha256:'1'.repeat(64),channels:1,sampleRate:44100,frames:4410};
const pcm=Int16Array.from({length:sample.frames},(_,i)=>Math.round(2200*Math.sin(2*Math.PI*i/441)));
const model=createInstrument({id:'tone',revision:1,samples:[sample],regions:[{id:'held',sample:'tone',group:'main',root:60,
  loop:{start:441,end:3528},envelope:{attackMs:2,decayMs:0,sustain:1,releaseMs:10}}]});
function setup(mode) {
  const e=new Engine(wasm,session);e.advance(4000);
  const x=e.ex,rt=new SamplerRuntime(x);
  const cmd=(t,data)=>rt.command({t,...data});
  const {token}=cmd('daw-sampler-begin',{ref,request:'upload',packed:packSampler(model)});
  cmd('daw-sampler-chunk',{token,sampleId:'tone',offset:0,pcm});cmd('daw-sampler-commit',{token});
  cmd('daw-sampler-live',{ref,keyboardFx:mode});
  assert(x.waswan_studio_parameter_set(0,62,110)); // P_REV_MIX, shared Synth return
  for(const p of [0,1]) assert(x.waswan_studio_mix_set(p,4,127)); // Reverb send
  x.waswan_daw_taps(1);e.advance(200);
  const fx=keyboardFx=>cmd('daw-sampler-keyboard-fx',{ref,keyboardFx});
  const note=v=>e.input({t:'midi',st:v?144:128,d1:60,d2:v});
  function render(blocks) {
    const out=new Float32Array(blocks*128*2),other=new Float32Array(out.length);
    for(let b=0;b<blocks;b++){
      e.render(128);
      for(let c=0;c<2;c++){
        const at=(2*b+c)*128;
        out.set(new Float32Array(x.memory.buffer,c?x.sim_out_r():x.sim_out_l(),128),at);
        other.set(new Float32Array(x.memory.buffer,x.waswan_daw_output(1,c),128),at);
      }
    }
    return {out,other};
  }
  return {x,cmd,fx,note,render};
}
const peak=arr=>arr.reduce((m,v)=>Math.max(m,Math.abs(v)),0);

function tail(mode) {
  const h=setup(mode);h.note(105);
  const sounding=peak(h.render(100).out);
  h.note(0);h.render(40);
  return {sounding,tail:peak(h.render(140).out)};
}
const dry=tail(),wet=tail('synth');
assert(dry.sounding>0.001 && wet.sounding>0.001);
assert(dry.tail<0.0001 && wet.tail>0.002,JSON.stringify({dry,wet}));

function partASequence(keyboardMode) {
  const h=setup(keyboardMode);
  assert(h.x.waswan_studio_note(0,52,90));
  const signal=h.render(100).out;
  assert(h.x.waswan_studio_note(0,52,0));
  h.render(40);
  return {signal,tail:h.render(140).out};
}
const sequenced=partASequence('dry');
assert(peak(sequenced.signal)>0.001 && peak(sequenced.tail)>0.002);
assert.deepEqual(sequenced,partASequence('synth'),'Sequenced notes on the same Part A retain their effects');

function masterTest(mode,colored) {
  const h=setup(mode);
  if(colored){
    for(const [field,value] of [[8,5],[9,70],[10,60]]) assert(h.x.waswan_instrument_set(field,value));
  }
  h.note(105);const result=h.render(80).out;
  assert(h.x.waswan_instrument_set(7,0));
  h.render(32);assert.equal(peak(h.render(10).out),0,mode+' respects master volume');
  return result;
}
assert.deepEqual(masterTest('dry',true),masterTest('dry',false),'Dry bypasses the DJ filter, drive and compressor');
assert.notDeepEqual(masterTest('synth',true),masterTest('synth',false),'Use Synth FX follows the master controls');

function sequence(withKeyboard,toggle) {
  const h=setup('dry');
  assert(h.x.waswan_studio_note(1,52,80));
  if(withKeyboard) h.note(98);
  h.render(20);
  const blocks=[];
  for(const mode of ['synth','dry']){
    if(toggle) h.fx(mode);
    const rendered=h.render(120);
    if(withKeyboard) {
      assert.equal(Array.from({length:256},(_,i)=>h.x.waswan_sampler_voice_region(i)).filter(Boolean).length,1);
      assert(peak(rendered.out)>0.001);
    }
    blocks.push(rendered);
  }
  h.note(0);assert(h.x.waswan_studio_note(1,52,0));
  return blocks;
}
const plain=sequence(false,false),otherOnly=sequence(false,true);
const simultaneous=sequence(true,true),alwaysDry=sequence(true,false);
for(let i=0;i<2;i++){
  assert(peak(plain[i].other)>0.001);
  assert.deepEqual(otherOnly[i].out,plain[i].out,'Other part and its effects remain bit-identical');
  assert.deepEqual(simultaneous[i].other,alwaysDry[i].other,'Concurrent Part B bus remains bit-identical');
}
assert.notDeepEqual(simultaneous[0].out,alwaysDry[0].out,'Held note follows a live FX change');
const h=setup('dry');
assert.throws(()=>h.fx('wrong'),/Choose Dry/);
assert.throws(()=>h.cmd('daw-sampler-keyboard-fx',{ref:{...ref,revision:2},keyboardFx:'synth'}),/route changed/);
console.log('PASS keyboard FX, measured peak amplitudes',JSON.stringify({dry,wet,
  otherPartCompared:plain.reduce((sum,b)=>sum+b.out.length,0)}));
