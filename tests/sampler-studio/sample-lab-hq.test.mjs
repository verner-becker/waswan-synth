// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime} from '../../web/sampler-runtime.js';
import {createInstrument} from '../../web/sampler-instrument.js';
import {encodeSample,processWav} from '../../web/sampler-offline.js';
import {pitchRecipe,pitchAdapters} from '../../web/sampler-lab-pitch.js';
import {decodeWav} from '../../web/sampler-wav.js';

const rate=44100,seconds=1,frames=rate*seconds;
const partial=(i,hz)=>Math.sin(2*Math.PI*hz*i/rate);
const fixture={channels:1,sampleRate:rate,pcm:Float32Array.from({length:frames},(_,i)=>
  (.30*partial(i,220)+.11*partial(i,440)+.07*partial(i,660))*Math.min(1,i/240,(frames-1-i)/240))};
const wav=encodeSample(fixture);
const wasm=await readFile('.local/build/sampler-pitch.wasm');
const range={start:0,end:frames},algorithm='signalsmith-stretch';
const start=performance.now();
const output=await processWav(wav,{type:'lab-pitch',algorithm,range,parameters:{semitones:3,formants:true}},{wasm});
const elapsedMs=performance.now()-start;
assert.equal(output.report.frames,frames);
assert.equal(output.report.overRange,0);
assert(Math.abs(output.report.driftCents)<30);
const recipe=[{type:'trim',...range},pitchRecipe(pitchAdapters[algorithm],output.parameters)];
const repeated=await processWav(wav,{type:'edit',recipe},{wasm});
assert.deepEqual(await repeated.wav.arrayBuffer(),await output.wav.arrayBuffer());
await assert.rejects(()=>processWav(wav,{type:'lab-pitch',algorithm,range,parameters:{semitones:7,formants:true}},{wasm}),/±3/);
await assert.rejects(()=>processWav(wav,{type:'edit',recipe:[{...recipe[1],algorithmVersion:2}]},{wasm}),/different algorithm version/);

// 16 kHz doubled lies above Nyquist. Folding into 12.1 kHz is an objective
// alias on this reference. The separate 2 kHz component should land at 4 kHz.
const reference=encodeSample({...fixture,pcm:Float32Array.from({length:frames},(_,i)=>
  .22*partial(i,2000)+.21*partial(i,16000))});
const {pcm}=await decodeWav(reference);
const engine=new Engine(await readFile('.local/build/waswan-256.wasm'),
  await readFile('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
engine.advance(4000);
const x=engine.ex,runtime=new SamplerRuntime(x);
assert(x.waswan_mel_patch());assert(x.waswan_daw_apply(1,x.waswan_daw_token()));x.waswan_daw_taps(1);
const ref={libraryId:'sample-lab',instrumentId:'alias-fixture',revision:1};
const instrument=createInstrument({id:ref.instrumentId,revision:1,
  samples:[{id:'reference',path:'Samples/alias.wav',sha256:createHash('sha256')
    .update(new Uint8Array(await reference.arrayBuffer())).digest('hex'),sampleRate:rate,frames,channels:1}],
  regions:[{id:'reference',sample:'reference',group:'main',root:60,mode:'oneShot'}]});
const {token}=runtime.command({t:'daw-sampler-begin',request:'lab',ref,instrument});
for(let offset=0;offset<pcm.length;offset+=32768)
  runtime.command({t:'daw-sampler-chunk',token,sampleId:'reference',offset,pcm:pcm.subarray(offset,offset+32768)});
runtime.command({t:'daw-sampler-commit',token});
runtime.applySlots(runtime.prepareSlots([{...ref,part:0,trackId:'lab',type:'sampler'}]));
assert(x.waswan_daw_note(0,72,100));
const captured=new Float32Array(16384);
for(let i=0;i<captured.length;i+=128){
  engine.render(128);
  captured.set(new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,0),128),i);
}
function spectralPeak(hz) {
  let maximum=0;
  for(let f=hz-12;f<=hz+12;f+=1){
    let real=0,imag=0;
    for(let i=256;i<captured.length;i++){
      const phase=2*Math.PI*f*i/rate;
      real+=captured[i]*Math.cos(phase);imag+=captured[i]*Math.sin(phase);
    }
    maximum=Math.max(maximum,2*Math.hypot(real,imag)/(captured.length-256));
  }
  return maximum;
}
const valid=spectralPeak(4000),folded=spectralPeak(12100);
assert(valid>.10&&folded>.10);
const evidence='.local/validation/sample-lab';
await mkdir(evidence,{recursive:true});
await writeFile(evidence+'/synthetic-native-alias.wav',new Uint8Array(await encodeSample({
  sampleRate:rate,channels:1,pcm:captured,
}).arrayBuffer()));
await writeFile(evidence+'/synthetic-native-alias.json',JSON.stringify({validHz:4000,valid,foldedHz:12100,folded,elapsedMs,wasmBytes:wasm.length},null,2)+'\n');
console.log('PASS bounded Signalsmith render and exact recipe replay, native 12.1 kHz alias fixture');
