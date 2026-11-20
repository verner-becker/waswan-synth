// SPDX-License-Identifier: GPL-3.0-only
import {checkAudio, levels} from './sampler-edit.js';

// Compare equal windows at each lag. Averaging before decimation keeps the
// computation bounded; a missing or unstable fundamental can yield no pitch.
function fundamental(pcm, rate) {
  const size = Math.floor(pcm.length / 2), maxLag = Math.min(size - 1, Math.ceil(rate / 45));
  const minLag = Math.max(2, Math.floor(rate / 1800)), diff = new Float64Array(maxLag + 1);
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += (pcm[i] - pcm[i + lag]) ** 2;
    running += sum;
    diff[lag] = running ? sum * lag / running : 1;
  }
  for (let lag = minLag; lag < maxLag - 1; lag++) {
    if (diff[lag] > 0.10) continue;
    while (lag + 1 < maxLag && diff[lag+1] < diff[lag]) lag++;
    const a = diff[lag-1], b = diff[lag], c = diff[lag+1];
    const d = a + c - 2*b, period = lag + (d ? (a-c)/(2*d) : 0);
    if (!(period > 0)) continue;
    let real = 0, imag = 0, power = 0;
    for (let i = 0; i < pcm.length; i++) {
      const window = 0.5 - 0.5 * Math.cos(2*Math.PI*i/(pcm.length-1));
      real += window * pcm[i] * Math.cos(2*Math.PI*i/period);
      imag += window * pcm[i] * Math.sin(2*Math.PI*i/period);
      power += window * pcm[i] ** 2;
    }
    if (4 * (real*real + imag*imag) < 0.045 * pcm.length * power) return null;
    return {hz:rate/period, confidence:1-b};
  }
  return null;
}

export function detectPitch(audio) {
  const frames = checkAudio(audio), {sampleRate, channels, pcm} = audio;
  const stride = Math.max(1, Math.floor(sampleRate/11025)), size = Math.min(1536, Math.floor(frames/stride));
  const unknown = reason => ({hz:null, root:null, confidence:0, reason});
  if (size < 256) return unknown('too-short');
  const estimates = [];
  for (const fraction of [0.17,0.43,0.70]) {
    const start = Math.floor((frames-size*stride)*fraction);
    const window = new Float32Array(size);
    let bestChannel = 0;
    if (channels === 2) {
      let left = 0, right = 0;
      for (let i = start; i < start+size*stride; i+=stride) {
        left += pcm[2*i]**2; right += pcm[2*i+1]**2;
      }
      if (right > left) bestChannel = 1;
    }
    let energy = 0, mean = 0;
    for (let i = 0; i < size; i++) {
      let value = 0;
      for (let j = 0; j < stride; j++) value += pcm[(start+i*stride+j)*channels+bestChannel];
      window[i] = value/stride; mean += window[i];
    }
    mean /= size;
    for (let i = 0; i < size; i++) { window[i] -= mean; energy += window[i]**2; }
    if (energy / size < 1e-8) continue;
    const estimate = fundamental(window,sampleRate/stride);
    if (estimate) estimates.push(estimate);
  }
  if (estimates.length < 2) return unknown('insufficient-periodicity');
  estimates.sort((a,b) => a.hz-b.hz);
  const spreadCents = 1200*Math.log2(estimates.at(-1).hz/estimates[0].hz);
  if (spreadCents > 35) return unknown('unstable-period');
  const hz = estimates[Math.floor(estimates.length/2)].hz, midi = 69+12*Math.log2(hz/440);
  return {hz,root:Math.round(midi),cents:100*(midi-Math.round(midi)),spreadCents,
    confidence:Math.min(...estimates.map(e=>e.confidence))};
}

export function analyzeSample(audio, {hopFrames = Math.max(1,Math.round(audio.sampleRate * 0.005)),
  thresholdDb = -48, minGapMs = 35} = {}) {
  const frames = checkAudio(audio), {channels,pcm,sampleRate} = audio;
  if (!Number.isInteger(hopFrames) || hopFrames < 1 || Math.ceil(frames/hopFrames)>100000 ||
      !Number.isFinite(thresholdDb) || thresholdDb < -144 || thresholdDb > 0 ||
      !Number.isFinite(minGapMs) || minGapMs < 0) throw Error('Invalid analysis window or threshold');
  const envelope = [], transients = [], floor = 10**(thresholdDb/20);
  let previous = 0, last = -Infinity, highest = -1, peakFrame = 0;
  for (let start = 0; start < frames; start += hopFrames) {
    const end = Math.min(frames,start+hopFrames);
    const {peak,rms} = levels(pcm.subarray(start*channels,end*channels));
    envelope.push({start,peak,rms});
    if (peak > highest) { highest=peak; peakFrame=start; }
    if (peak>=floor && rms > Math.max(previous*2.2, floor*0.25) && start-last>=minGapMs*sampleRate/1000) {
      let at = start;
      while (at < end && Math.abs(pcm[at*channels]) < peak*0.25 &&
        (channels===1 || Math.abs(pcm[at*2+1]) < peak*0.25)) at++;
      if (at<end) {transients.push(at); last=at;}
    }
    previous = 0.55*previous+0.45*rms;
  }
  const clipping = Array.from({length:channels},()=>({frames:0,runs:0,longestRun:0}));
  for(let c=0;c<channels;c++){
    let streak=0;
    for(let i=c;i<pcm.length;i+=channels){
      if(pcm[i]>=32767/32768 || pcm[i]<=-1){
        if(!streak)clipping[c].runs++;
        clipping[c].frames++;clipping[c].longestRun=Math.max(clipping[c].longestRun,++streak);
      }else streak=0;
    }
  }
  return {...levels(pcm), clipping, frames, duration:frames/sampleRate, peakFrame,
    pitch:detectPitch(audio), envelope, transients};
}

export function suggestLoops(audio, {start, end, radius=128}={}) {
  const frames = checkAudio(audio), {channels,pcm} = audio;
  start ??= Math.floor(frames*0.3); end ??= Math.floor(frames*0.75);
  if (!Number.isInteger(start)||!Number.isInteger(end)||!Number.isInteger(radius)||radius<1||
      radius>4096||start<0||end>frames||end<=start) throw Error('Invalid loop search interval');
  const width = Math.min(32,frames-end,start,Math.floor((end-start)/2));
  if (width<4) return [];
  const candidates=[];
  for(let boundary=Math.max(start+width,end-radius,width);boundary<=Math.min(frames-width,end+radius);boundary++){
    let delta=0, energy=0;
    for(let j=-width;j<width;j++)for(let c=0;c<channels;c++){
      const a=pcm[(start+j)*channels+c],b=pcm[(boundary+j)*channels+c];
      delta+=(a-b)**2; energy+=a*a+b*b;
    }
    if(energy>1e-8)candidates.push({start,end:boundary,error:delta/energy});
  }
  return candidates.sort((a,b)=>a.error-b.error||Math.abs(a.end-end)-Math.abs(b.end-end)).slice(0,5);
}

// Explicit recording notes and MIDI velocities outrank filename suggestions.
// Review the returned proposals before adding regions to a published instrument.
export function suggestMapping(entries) {
  if (!Array.isArray(entries) || !entries.length) throw Error('Choose samples for mapping');
  const rows=entries.map(({sample,root,velocity,pitch})=>{
    const name=sample.path.split('/').at(-1).replace(/\.wav$/i,'');
    const note=name.match(/(?:^|[ _-])([A-G])([#b]?)(-?[0-9])(?=$|[ _-])/i);
    const numeric=name.match(/^(\d{1,3})(?:$|[ _-])/);
    let candidate=root, origin='recording';
    if(candidate===undefined){
      origin='filename';
      if(note){const step={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[note[1].toUpperCase()];
        candidate=(Number(note[3])+1)*12+step+(note[2]==='#'?1:note[2]==='b'?-1:0);}
      else if(numeric) candidate=Number(numeric[1]);
      else {candidate=pitch?.root;origin='analysis';}
    }
    const dynamic=velocity??Number(name.match(/(?:^|[ _-])v(?:el)?(\d{1,3})(?:$|[ _-])/i)?.[1]);
    return {sample:sample.id,root:Number.isInteger(candidate)&&candidate>=0&&candidate<=127?candidate:null,
      velocity:Number.isInteger(dynamic)&&dynamic>=1&&dynamic<=127?dynamic:null,origin,
      confidence:origin==='analysis'?(pitch?.confidence??0):null};
  });
  const keys=[...new Set(rows.map(r=>r.root).filter(n=>n!==null))].sort((a,b)=>a-b);
  const bounds=(values,value,lo,hi)=>{const i=values.indexOf(value);return [
    i===0?lo:Math.floor((values[i-1]+value)/2)+1,
    i===values.length-1?hi:Math.floor((values[i+1]+value)/2)];};
  return rows.map(row=>{
    if(row.root===null)return {...row,key:null,layer:null};
    const dynamics=[...new Set(rows.filter(r=>r.root===row.root&&r.velocity!==null).map(r=>r.velocity))].sort((a,b)=>a-b);
    return {...row,key:bounds(keys,row.root,0,127),layer:row.velocity===null?null:bounds(dynamics,row.velocity,1,127)};
  });
}
