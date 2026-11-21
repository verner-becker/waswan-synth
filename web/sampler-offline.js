// SPDX-License-Identifier: GPL-3.0-only
import {importOriginal, readSampleFile} from './sampler-library.js';
import {createInstrument} from './sampler-instrument.js';
import {asBlob, decodePCM, inspectWav} from './sampler-wav.js';
import {checkAudio, splitFrames} from './sampler-edit.js';
import {renderRecipe} from './sampler-transform.js';
import {analyzeSample, suggestLoops} from './sampler-analysis.js';
import {pcm16, wavHeader} from './studio-format.js';
import {checkFrameRange, waveformPeaks} from './sampler-waveform.js';

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

// The seam estimator only compares small windows at the two ends. Omit the
// middle of a long selection, then translate candidate ends back to the WAV.
async function loopsInRange(file,layout,range) {
  checkFrameRange(range,layout.frames);
  const {start,end}=range,{channels,sampleRate,offset}=layout;
  const width=Math.min(32,Math.floor((end-start)/5)),radius=128;
  if(width<4)return [];
  const headEnd=start+2*width,tailStart=Math.max(headEnd,end-2*width-radius);
  const stride=channels*2;
  const bytes=await new Blob([file.slice(offset+start*stride,offset+headEnd*stride),
    file.slice(offset+tailStart*stride,offset+end*stride)]).arrayBuffer();
  const frames=bytes.byteLength/stride;
  const integers=decodePCM(bytes,{offset:0,frames,channels});
  const pcm=Float32Array.from(integers,value=>value/32768);
  return suggestLoops({channels,sampleRate,pcm},{start:width,end:frames-width,radius})
    .map(point=>({...point,start:start+point.start,end:start+point.end+tailStart-headEnd}));
}

export async function processWav(file, job) {
  const blob = asBlob(file);
  const layout = await inspectWav(blob,{anyRate:true});
  if (job.type === 'waveform') return waveformPeaks(blob, layout, job);
  if (job.type === 'loops' && job.range) return loopsInRange(blob,layout,job.range);
  let recipe = job.recipe;
  let start = 0, end = layout.frames;
  // A leading trim is a frame range on the original. Read it before allocating
  // a float buffer, so short excerpts from long field recordings fit in memory.
  if (job.type === 'edit' && Array.isArray(recipe) && recipe[0]?.type === 'trim') {
    if (recipe.length > 128) throw Error('Invalid edit recipe');
    ({start,end} = recipe[0]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
        end <= start || end > layout.frames) throw Error('Invalid trim range');
    recipe = recipe.slice(1);
  }
  const frames = end-start, {channels,sampleRate} = layout;
  if (frames*channels > 32*1024*1024) throw Error('Offline sample budget exceeded');
  const bytesPerFrame = channels*2;
  const bytes = await blob.slice(layout.offset+start*bytesPerFrame,layout.offset+end*bytesPerFrame).arrayBuffer();
  const pcm = decodePCM(bytes,{offset:0,frames,channels});
  const source = {channels,sampleRate,pcm:Float32Array.from(pcm,value=>value/32768)};
  if (job.type === 'analyze') return analyzeSample(source,job.options);
  if (job.type === 'loops') return suggestLoops(source,job.options);
  if (job.type !== 'edit') throw Error('Unknown offline operation');
  const {audio,report} = renderRecipe(source,recipe);
  return {wav:encodeSample(audio),report};
}

// Worker lifetime is exactly one operation. Cancel also stops CPU-bound analysis.
export function runOffline(file, job, {signal,onProgress}={}) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./sampler-offline-worker.js',import.meta.url),{type:'module'});
    const finish=(fn,value)=>{worker.terminate();signal?.removeEventListener('abort',abort);fn(value);};
    const abort=()=>finish(reject,signal.reason);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{
      if (data.progress !== undefined) onProgress?.(data.progress);
      else if (data.ok) finish(resolve,data.value);
      else finish(reject,Error(data.error));
    };
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
