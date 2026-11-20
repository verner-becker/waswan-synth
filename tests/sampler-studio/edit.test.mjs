// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {editSample,levels,splitFrames} from '../../web/sampler-edit.js';
import {analyzeSample,detectPitch,suggestLoops} from '../../web/sampler-analysis.js';

const mono=(pcm,sampleRate=48000)=>({sampleRate,channels:1,pcm:Float32Array.from(pcm)});
const tone=(hz,rate=48000,frames=rate)=>mono(Array.from({length:frames},(_,i)=>.45*Math.sin(2*Math.PI*hz*i/rate)),rate);
const original=mono([0,0,.5,.25,-.25,-.5,0,0]);
const {audio,report}=editSample(original,[{type:'trimSilence',minFrames:2},{type:'reverse'},
  {type:'normalizeRms',targetDb:0,ceilingDb:-6},{type:'fade',inFrames:2,outFrames:2}]);
assert.deepEqual([...original.pcm],[0,0,.5,.25,-.25,-.5,0,0]);
assert.equal(audio.pcm.length,4);assert.equal(Math.abs(audio.pcm[0]),0);assert.equal(Math.abs(audio.pcm.at(-1)),0);
assert(Math.abs(report[0].peak-10**(-6/20))<1e-6);
assert(levels(editSample(mono([0,0]),[{type:'normalizePeak'}]).audio.pcm).peak===0);
const stereo=editSample(original,[{type:'channels',channels:2}]).audio;
assert.deepEqual(Array.from(stereo.pcm.filter((_,i)=>i%2)),[...original.pcm]);
for(let i=1;i<stereo.pcm.length;i+=2)stereo.pcm[i]*=-1;
assert(editSample(stereo,[{type:'channels',channels:1}]).audio.pcm.every(v=>v===0));
const a=tone(440), converted=editSample(a,[{type:'rate',sampleRate:44100}]).audio;
assert.equal(converted.pcm.length,44100);
const p=detectPitch(converted);assert.equal(p.root,69);assert(p.confidence>.9);assert(Math.abs(p.cents)<10);
const alias=editSample(tone(18000),[{type:'rate',sampleRate:22050}]).audio;
assert(levels(alias.pcm.subarray(100,-100)).rms<.003);
let seed=1;const noise=mono(a.pcm.map(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32-.5;}));
assert.equal(detectPitch(noise).root,null);assert.equal(detectPitch(mono(new Float32Array(8192))).root,null);
const hits=mono(new Float32Array(24000));
for(const pos of [1000,7000,14000])for(let i=0;i<240;i++)hits.pcm[pos+i]=.9*Math.exp(-i/30);
assert.deepEqual(analyzeSample(hits).transients,[1000,7000,14000]);
assert.deepEqual(splitFrames(24000,[14000,1000,7000]),[[0,1000],[1000,7000],[7000,14000],[14000,24000]]);
const loop=suggestLoops(a,{start:6000,end:12000})[0];assert(loop.error<1e-3);
const smooth=editSample(a,[{type:'loopCrossfade',start:1234,end:4589,frames:80}]).audio;
assert(Math.abs(smooth.pcm[4588]-a.pcm[1233])<1e-6);
assert.deepEqual(levels(Float32Array.of(1,1,0,-1)).clipped,3);
assert.throws(()=>editSample(original,[{type:'trim',start:3,end:2}]));
console.log('PASS offline edits, RMS ceiling, silence, stereo, resampling and alias rejection, pitch/confidence, slicing, loops');
const {suggestMapping}=await import('../../web/sampler-analysis.js');
const proposals=suggestMapping(['C4 v32','C4 v96','D4','Unknown'].map((name,id)=>({sample:{id,path:name+'.wav'}})));
assert.deepEqual(proposals.map(r=>[r.root,r.key,r.layer]),[[60,[0,61],[1,64]],[60,[0,61],[65,127]],[62,[62,127],null],[null,null,null]]);
for (const frequencies of [[220,277.183,329.628],[330,467]]) {
  const chord=mono(Float32Array.from({length:48000},(_,i)=>frequencies.reduce((v,f)=>v+Math.sin(i*2*Math.PI*f/48000)/frequencies.length,0)));
  assert.equal(detectPitch(chord).root,null);
}
