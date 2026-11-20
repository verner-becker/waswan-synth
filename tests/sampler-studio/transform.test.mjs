// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {beatSlices,stretch,pitchShift,granular,renderRecipe} from '../../web/sampler-transform.js';
import {analyzeSample,detectPitch} from '../../web/sampler-analysis.js';
import {encodeSample} from '../../web/sampler-offline.js';
const rate=44100;
const mono=fn=>({sampleRate:rate,channels:1,pcm:Float32Array.from({length:rate},(_,i)=>fn(i, i/rate))});
const sustained=mono((i,t)=>.48*Math.sin(t*2*Math.PI*220));
const chord=mono((i,t)=>[220,277.183,329.628].reduce((s,f)=>s+.18*Math.sin(t*2*Math.PI*f),0));
const hits=mono(i=>{const d=i-2205-Math.floor((i-2205)/8820)*8820;return i>=2205&&d<300?.6*Math.exp(-d/50)*Math.cos(d*.42):0;});
const stereo={sampleRate:rate,channels:2,pcm:Float32Array.from({length:rate*2},(_,i)=>sustained.pcm[i>>1]*(i%2?-.5:1))};
const metrics=[], artifacts=[];
function spectrum(pcm,hz){
  const frames=8192,start=Math.floor((pcm.length-frames)/2);let re=0,im=0;
  for(let i=0;i<frames;i++){const value=pcm[i+start]*(1-Math.cos(2*Math.PI*i/frames)),a=2*Math.PI*hz*i/rate;
    re+=value*Math.cos(a);im+=value*Math.sin(a);}
  return Math.hypot(re,im)/frames;
}
for(const factor of [.75,1.5]){
  const before=performance.now(),res=stretch(sustained,factor),p=detectPitch(res);
  assert.equal(res.pcm.length,Math.round(rate*factor));assert.equal(p.root,57);assert(Math.abs(p.cents)<10);
  const poly=stretch(chord,factor);
  for(const hz of [220,277.183,329.628])assert(spectrum(poly.pcm,hz)>.035);
  const rhythm=stretch(hits,factor),onsets=analyzeSample(rhythm,{minGapMs:50}).transients;
  assert.equal(onsets.length,5,'preserve each attack without doubling or omission: '+onsets);
  let worst=0;
  for(let n=0;n<5;n++)worst=Math.max(worst,Math.abs(onsets[n]-(2205+8820*n)*factor));
  assert(worst<rate*.045,'onset displacement beyond 45 ms: '+worst);
  const spatial=stretch(stereo,factor);
  assert(spatial.pcm.every((v,i,pcm)=>i%2===0||Math.abs(v+.5*pcm[i-1])<2e-6));
  metrics.push({factor,cents:p.cents,worstOnsetMs:worst*1000/rate,milliseconds:performance.now()-before});
  artifacts.push(['rhythm-'+factor,rhythm],['chord-'+factor,poly]);
}
for(const semitones of [-3,3]){
  const res=pitchShift(sustained,semitones),p=detectPitch(res);
  assert.equal(res.pcm.length,rate);assert.equal(p.root,57+semitones);assert(Math.abs(p.cents)<10);
  metrics.push({semitones,cents:p.cents});artifacts.push(['pitch-'+semitones,res]);
}
const recipe={type:'granular',seconds:2,grainMs:120,density:35,positions:[.2,.8,.3],jitter:.3,seed:137,detuneCents:40};
const texture=granular(chord,recipe);
assert.deepEqual(renderRecipe(chord,[recipe]).audio.pcm,texture.pcm);
assert.notDeepEqual(granular(chord,{...recipe,seed:3}).pcm,texture.pcm);
assert(texture.pcm.every(Number.isFinite));assert(texture.pcm.some(v=>Math.abs(v)>.01));
assert.deepEqual(beatSlices(sustained,{bpm:120,beatsPerSlice:.5}),[[0,11025],[11025,22050],[22050,33075],[33075,44100]]);
assert.throws(()=>stretch(sustained,8));
const dir=process.env.SAMPLER_VALIDATION_ROOT || '.local/validation/sampler-studio-4';
await mkdir(dir,{recursive:true});
for(const [name,audio] of [...artifacts,['granular-drone',texture]])await writeFile(join(dir,name+'.wav'),Buffer.from(await encodeSample(audio).arrayBuffer()));
await writeFile(join(dir,'transform.json'),JSON.stringify(metrics,null,2));
console.log('PASS transformations',JSON.stringify(metrics));
