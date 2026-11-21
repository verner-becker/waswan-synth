// SPDX-License-Identifier: GPL-3.0-only
// Offline transformations. All channels use a common read position and splice.
import {checkAudio,convertRate,editSample,splitFrames} from './sampler-edit.js';

const maxScalars=32*1024*1024;
function bounded(value,lo,hi,name) {
  if (!Number.isFinite(value)||value<lo||value>hi) throw Error('Invalid '+name);
  return value;
}
function outputBuffer(frames,channels) {
  if(!Number.isSafeInteger(frames)||frames<1||frames*channels>maxScalars)throw Error('Offline transform exceeds memory budget');
  return new Float32Array(frames*channels);
}
export function beatSlices(audio,{bpm,beatsPerSlice=1,offset=0}) {
  const frames=checkAudio(audio);
  bounded(bpm,10,480,'tempo');bounded(beatsPerSlice,1/64,64,'beat division');
  if(!Number.isInteger(offset)||offset<0||offset>=frames)throw Error('Invalid grid offset');
  const stride=audio.sampleRate*60*beatsPerSlice/bpm;
  if((frames-offset)/stride>32768)throw Error('Grid slice budget exceeded');
  const markers=[];
  for(let beat=0;;beat++){const frame=Math.round(offset+beat*stride);if(frame>=frames)break;markers.push(frame);}
  return splitFrames(frames,markers);
}

function scoreSplice(source, output, candidate, start, overlap, channels) {
  let dot=0, inEnergy=0, outEnergy=0;
  // Compare a sparse window on both channels, including anti-phase stereo.
  for(let i=0;i<overlap;i+=8)for(let c=0;c<channels;c++){
    const a=source[(candidate+i)*channels+c], b=output[(start+i)*channels+c];
    dot+=a*b;inEnergy+=a*a;outEnergy+=b*b;
  }
  return inEnergy*outEnergy>1e-15?dot/Math.sqrt(inEnergy*outEnergy):0;
}

// Overlap-add with waveform-similarity alignment (WSOLA). The search stays
// near the absolute time map, so alignment corrections cannot accumulate drift.
export function stretch(audio, factor) {
  const frames=checkAudio(audio), {channels,pcm,sampleRate}=audio;
  bounded(factor,.5,2,'duration factor');
  if(factor===1)return {...audio,pcm:pcm.slice()};
  const resultFrames=Math.max(1,Math.round(frames*factor));
  const out=outputBuffer(resultFrames,channels);
  const hop=Math.max(1,Math.min(Math.round(sampleRate*.02),Math.floor(frames/4)));
  const span=hop*2, search=Math.round(sampleRate*.008);
  if(frames<span*2||resultFrames<span){throw Error('Time stretch needs at least two overlapping analysis windows');}
  out.set(pcm.subarray(0,Math.min(span,resultFrames)*channels));
  for(let start=hop;start<resultFrames;start+=hop) {
    const ideal=Math.min(frames-span,Math.round(start/factor)),lo=Math.max(0,ideal-search),hi=Math.min(frames-span,ideal+search);
    const overlap=Math.min(hop,resultFrames-start);
    let best=ideal,score=scoreSplice(pcm,out,best,start,overlap,channels);
    // Coarse-to-fine search. Keep the nominal position on silence or ties.
    for(let candidate=lo;candidate<=hi;candidate+=8) {
      const value=scoreSplice(pcm,out,candidate,start,overlap,channels);
      if(value>score+1e-6){best=candidate;score=value;}
    }
    const coarse=best;
    for(let candidate=Math.max(lo,coarse-7);candidate<=Math.min(hi,coarse+7);candidate++){
      const value=scoreSplice(pcm,out,candidate,start,overlap,channels);
      if(value>score+1e-6){best=candidate;score=value;}
    }
    for(let i=0;i<Math.min(span,resultFrames-start);i++){
      const weight=i>=hop?1:0.5-0.5*Math.cos(Math.PI*i/hop);
      for(let c=0;c<channels;c++){
        const dst=(start+i)*channels+c;
        out[dst]=out[dst]*(1-weight)+pcm[(best+i)*channels+c]*weight;
      }
    }
  }
  return {pcm:out,sampleRate,channels};
}

export function pitchShift(audio,semitones) {
  const frames=checkAudio(audio);
  bounded(semitones,-12,12,'pitch shift');
  if(semitones===0)return {...audio,pcm:audio.pcm.slice()};
  const ratio=2**(semitones/12);
  const elongated=stretch(audio,ratio);
  const pitched=convertRate(elongated,Math.round(audio.sampleRate/ratio));
  const out=outputBuffer(frames,audio.channels);
  out.set(pitched.pcm.subarray(0,out.length));
  return {...audio,pcm:out};
}

// Position values are fractions of the usable source range. A seeded generator
// determines grain offsets and pitch variation identically on both channels.
export function granular(audio, options={}) {
  const frames=checkAudio(audio),{channels,pcm,sampleRate}=audio;
  const duration=bounded(options.seconds??1,.02,120,'texture duration');
  const grainMs=bounded(options.grainMs??70,5,500,'grain size');
  const density=bounded(options.density??25,1,150,'grain density');
  const jitter=bounded(options.jitter??.1,0,1,'position jitter');
  const detune=bounded(options.detuneCents??0,0,1200,'grain detune');
  const semi=bounded(options.semitones??0,-24,24,'grain transposition');
  const positions=options.positions??[.5];
  if(!Array.isArray(positions)||!positions.length||positions.length>1024)throw Error('Invalid grain position curve');
  positions.forEach(p=>bounded(p,0,1,'grain position'));
  if(!Number.isSafeInteger(options.seed??1))throw Error('Invalid grain seed');
  let seed=(options.seed??1)>>>0;
  const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  const length=Math.round(duration*sampleRate),out=outputBuffer(length,channels);
  const grain=Math.round(grainMs*sampleRate/1000),hop=sampleRate/density;
  const window=Float32Array.from({length:grain},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(grain-1)));
  const gain=1/Math.max(1,grain/(2*hop));
  for(let n=0;Math.round(n*hop)<length;n++){
    const at=Math.round(n*hop), t=at/(length-1)*(positions.length-1), k=Math.floor(t);
    const position=positions[k]+((positions[k+1]??positions[k])-positions[k])*(t-k);
    const step=2**((semi+(2*random()-1)*detune/100)/12);
    const usable=Math.max(0,frames-1-(grain-1)*step);
    let read=Math.max(0,Math.min(1,position+(2*random()-1)*jitter))*usable;
    for(let j=0;j<grain&&at+j<length&&read<frames;j++,read+=step){
      const i=Math.floor(read),f=read-i;
      for(let c=0;c<channels;c++){
        const a=pcm[i*channels+c], b=pcm[Math.min(frames-1,i+1)*channels+c];
        out[(at+j)*channels+c]+=(a+(b-a)*f)*window[j]*gain;
      }
    }
  }
  return {pcm:out,sampleRate,channels};
}

export function renderRecipe(source,recipe) {
  if(!Array.isArray(recipe)||recipe.length>128)throw Error('Invalid edit recipe');
  let audio=source,edits=[];
  const report=[];
  function flush(){if(edits.length){const result=editSample(audio,edits);audio=result.audio;report.push(...result.report);edits=[];}}
  for(const op of recipe){
    switch(op.type){
      case 'stretch': flush();audio=stretch(audio,op.factor);break;
      case 'pitchShift':
        if(op.algorithm!==undefined&&(op.algorithm!=='wsola'||op.algorithmVersion!==1))
          throw Error('This pitch recipe requires a different algorithm version.');
        flush();audio=pitchShift(audio,op.semitones);break;
      case 'granular': flush();audio=granular(audio,op);break;
      default: edits.push(op);
    }
  }
  flush();
  return {audio,report};
}
