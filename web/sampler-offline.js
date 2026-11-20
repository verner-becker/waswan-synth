// SPDX-License-Identifier: GPL-3.0-only
import {importOriginal, readSampleFile} from './sampler-library.js';
import {createInstrument} from './sampler-instrument.js';
import {decodeWav, inspectWav} from './sampler-wav.js';
import {checkAudio, editSample, splitFrames} from './sampler-edit.js';
import {analyzeSample, suggestLoops} from './sampler-analysis.js';
import {pcm16, wavHeader} from './studio-format.js';

export function encodeSample(audio) {
  const frames = checkAudio(audio), {channels,sampleRate} = audio;
  const header = wavHeader(frames), view = new DataView(header), bytes = frames*channels*2;
  view.setUint32(4,36+bytes,true); view.setUint16(22,channels,true); view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*channels*2,true); view.setUint16(32,channels*2,true); view.setUint32(40,bytes,true);
  const samples = pcm16(audio.pcm);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    const little = new DataView(samples.buffer);
    for (let i=0;i<samples.length;i++) little.setInt16(i*2,samples[i],true);
  }
  return new Blob([header,samples],{type:'audio/wav'});
}

export async function processWav(file, job) {
  const {frames,channels}=await inspectWav(file,{anyRate:true});
  if(frames*channels>32*1024*1024||file.size>128*1024*1024)throw Error('Offline sample budget exceeded');
  const decoded = await decodeWav(file,{anyRate:true});
  const source = {channels:decoded.channels,sampleRate:decoded.sampleRate,pcm:Float32Array.from(decoded.pcm,v=>v/32768)};
  if (job.type === 'analyze') return analyzeSample(source,job.options);
  if (job.type === 'loops') return suggestLoops(source,job.options);
  if (job.type !== 'edit') throw Error('Unknown offline operation');
  const {audio,report} = editSample(source,job.recipe);
  return {wav:encodeSample(audio),report};
}

// Worker lifetime is exactly one operation. Cancel also stops CPU-bound analysis.
export function runOffline(file, job, {signal}={}) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./sampler-offline-worker.js',import.meta.url),{type:'module'});
    const finish=(fn,value)=>{worker.terminate();signal?.removeEventListener('abort',abort);fn(value);};
    const abort=()=>finish(reject,signal.reason);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>data.ok?finish(resolve,data.value):finish(reject,Error(data.error));
    worker.onerror=e=>finish(reject,Error(e.message));
    try{worker.postMessage({file,job});}catch(error){finish(reject,error);}
  });
}

export async function renderDerivative(root, sample, recipe, destination, {signal, run=runOffline}={}) {
  if (!destination.startsWith('Samples/Processed/')) throw Error('Choose a destination in Samples/Processed');
  const file=await readSampleFile(root,sample,{signal,maxFileBytes:128*1024*1024});
  const {wav,report}=await run(file,{type:'edit',recipe},{signal});
  signal?.throwIfAborted();
  const derivative=await importOriginal(root,wav,destination,{source:{path:sample.path,sha256:sample.sha256},
    recipe:{version:1,operations:structuredClone(recipe)},license:sample.license,provenance:sample.provenance});
  return {sample:derivative,report};
}

export function instrumentFromSlices(sample, markers, {firstNote=36,name=sample.id}={}) {
  const spans=splitFrames(sample.frames,markers);
  if(!Number.isInteger(firstNote)||firstNote<0||firstNote+spans.length>128)throw Error('Slices exceed MIDI key range');
  return createInstrument({name,samples:[sample],regions:spans.map((frames,i)=>{
    const note=firstNote+i;
    return {id:'slice-'+(i+1),group:'main',sample:sample.id,frames,key:[note,note],root:note,mode:'oneShot'};
  })});
}
