// SPDX-License-Identifier: GPL-3.0-only
import {analyzeSample, detectPitch, suggestLoops} from './sampler-analysis.js';
import {levels} from './sampler-edit.js';
import {inspectWav, decodePCM} from './sampler-wav.js';
import {checkFrameRange} from './sampler-waveform.js';
import {renderRecipe} from './sampler-transform.js';
import {encodeSample} from './sampler-offline.js';
import {compile, validateInstrument} from './sampler-instrument.js';
import {mapSample, stageWorkingSampler} from './sampler.js';
import {importOriginal} from './sampler-library.js';
import {createWorking, saveWorking} from './sampler-working.js';

// Selection thresholds describe editable starting points, not calibrated probabilities.
const scanSeconds = 1, hopSeconds = 0.5, minActiveRms = 0.002;
const maxCandidates = 5, maxOverlap = 0.45;
export const excerptLimits = Object.freeze({minSeconds:0.06,maxSeconds:16});
const {minSeconds,maxSeconds} = excerptLimits;
const envelopeHopSeconds = 0.005, trimRelativeRms = 0.035;
const decayRatio = 0.45, earlyPeakFraction = 0.45, tailFraction = 0.25;
const ranking = {matchingCharacter:4,stablePitch:2,extraAttackPenalty:0.45,loopBonus:1};
const attackFraction = 0.85, decayFraction = 0.65, maxPitchDriftCents = 45;
const loopIntervals = [[0.2,0.7],[0.3,0.8],[0.4,0.85],[0.5,0.78]];
const maxSeamError = 0.12, maxLevelRatio = 2, minLoopSeconds = 0.12;
const playbackRate = 44100, chordPeakDb = -12;
const envelopePolicy = {
  Sustained:{attackMs:5, decayMs:80, sustain:0.9, releaseMs:140},
  Plucked:{attackMs:1, decayMs:80, sustain:1, releaseMs:25},
  Texture:{attackMs:12, decayMs:100, sustain:0.9, releaseMs:200},
};

async function readRange(file, layout, start, end) {
  const {channels, offset, sampleRate} = layout;
  const stride = channels * 2;
  const bytes = await file.slice(offset + start * stride, offset + end * stride).arrayBuffer();
  const integers = decodePCM(bytes,{offset:0, frames:end-start, channels});
  return {channels, sampleRate, pcm:Float32Array.from(integers, n => n / 32768)};
}

function activeRange(analysis, rate) {
  const hop = Math.max(1, Math.round(rate * envelopeHopSeconds));
  const floor = Math.max(minActiveRms, analysis.rms * trimRelativeRms);
  const first = analysis.envelope.find(bin => bin.rms >= floor);
  const last = analysis.envelope.findLast(bin => bin.rms >= floor);
  if (!first) return null;
  return {start:Math.max(0,first.start-hop), end:Math.min(analysis.frames,last.start+2*hop)};
}

function overlaps(a,b) {
  return (Math.min(a.end,b.end)-Math.max(a.start,b.start)) /
    Math.min(a.end-a.start,b.end-b.start) > maxOverlap;
}

function characterize(analysis) {
  const tail = analysis.envelope.slice(-Math.max(1,Math.floor(analysis.envelope.length*tailFraction)));
  const tailRms = tail.reduce((sum,b) => sum+b.rms,0) / tail.length;
  const decays = tailRms < analysis.rms * decayRatio && analysis.peakFrame < analysis.frames * earlyPeakFraction;
  return decays ? 'Plucked' : analysis.pitch.root !== null ? 'Sustained' : 'Texture';
}

export async function discoverCandidates(file, character='Auto', {signal,onProgress}={}) {
  const layout = await inspectWav(file,{anyRate:true});
  const {frames,sampleRate} = layout;
  const stride = Math.round(sampleRate*hopSeconds), window = Math.round(sampleRate*scanSeconds);
  const best = [];
  for (let start=0; start<frames; start+=stride) {
    signal?.throwIfAborted();
    const end = Math.min(frames,start+window);
    if (start % window === 0 || end===frames) onProgress?.(end/frames);
    const audio = await readRange(file,layout,start,end);
    if (levels(audio.pcm).rms < minActiveRms || end-start < minSeconds*sampleRate) continue;
    const analysis = analyzeSample(audio);
    const active = activeRange(analysis,sampleRate);
    if (!active || active.end-active.start < minSeconds*sampleRate) continue;
    const type = characterize(analysis), pitched = analysis.pitch.root !== null;
    const attacks = analysis.transients.length;
    const reason = [pitched?'Stable pitch · MIDI '+analysis.pitch.root:'Pitch uncertain',
      type==='Plucked'?'decaying attack':type==='Sustained'?'held tone':'evolving sound'];
    if (attacks>2) reason.push('several attacks, other sounds may overlap');
    if (analysis.clipped) reason.push('input reaches full scale');
    const score = (type===character?ranking.matchingCharacter:0) + (pitched?ranking.stablePitch:0) + (active.end-active.start)/window
      - Math.min(4,Math.max(0,attacks-1))*ranking.extraAttackPenalty - (analysis.pitch.spreadCents??35)/100;
    const candidate = {start:start+active.start,end:start+active.end,character:type,reason:reason.join(' · '),score};
    const conflicts = best.filter(other=>overlaps(other,candidate));
    if (conflicts.some(other=>other.score>=score)) continue;
    for (const other of conflicts) best.splice(best.indexOf(other),1);
    best.push(candidate);
    best.sort((a,b)=>b.score-a.score || a.start-b.start);
    if (best.length>maxCandidates) best.pop();
  }
  if (character==='Auto' || character==='Sustained') {
    for (const item of best.filter(c=>c.character==='Sustained')) {
      signal?.throwIfAborted();
      const audio = await readRange(file,layout,item.start,item.end);
      if (sustainLoop(audio,analyzeSample(audio))) {
        item.score += ranking.loopBonus;
        item.reason += ' · sustain loop suggested';
      }
    }
    best.sort((a,b)=>b.score-a.score || a.start-b.start);
  }
  signal?.throwIfAborted();
  return best;
}

function sustainLoop(audio, analysis) {
  const {pcm,channels,sampleRate} = audio;
  const {frames,pitch,envelope,transients} = analysis;
  if (frames < sampleRate*minLoopSeconds*2) return null;
  let best = null;
  for (const [lo,hi] of loopIntervals) {
    const start = Math.floor(frames*lo), end = Math.floor(frames*hi);
    if (end-start < minLoopSeconds*sampleRate || transients.some(t=>t>=start && t<=end)) continue;
    const body = envelope.filter(b=>b.start>=start && b.start<end);
    const energies = body.map(b=>b.rms).sort((a,b)=>a-b);
    if (!energies.length || energies[Math.floor(energies.length*0.1)] < minActiveRms ||
        energies[Math.floor(energies.length*0.9)] > maxLevelRatio*energies[Math.floor(energies.length*0.1)]) continue;
    const local = detectPitch({...audio,pcm:pcm.subarray(start*channels,end*channels)});
    if (local.root===null || (pitch.root!==null && Math.abs(1200*Math.log2(local.hz/pitch.hz))>maxPitchDriftCents)) continue;
    const radius = Math.min(2048,Math.ceil(sampleRate/local.hz));
    const seam = suggestLoops(audio,{start,end,radius})[0];
    if (seam && seam.error<=maxSeamError && (!best || seam.error<best.error)) best=seam;
  }
  return best && {start:best.start,end:best.end,mode:'forward',
    crossfade:Math.min(Math.round(sampleRate*0.01),Math.floor((best.end-best.start)/2))};
}

export async function proposeInstrument(file, range, options={}) {
  const layout = await inspectWav(file,{anyRate:true});
  checkFrameRange(range,layout.frames);
  const duration = (range.end-range.start)/layout.sampleRate;
  if (duration<minSeconds || duration>maxSeconds) throw Error('Select between 60 ms and 16 seconds for one playable excerpt.');
  const input = await readRange(file,layout,range.start,range.end);
  const measured = analyzeSample(input), bounds = activeRange(measured,layout.sampleRate);
  if (!bounds) throw Error('This selection is too quiet. Choose an audible attack or held tone.');
  const selection = [range.start+bounds.start,range.start+bounds.end];
  const length = bounds.end-bounds.start;
  if (length < minSeconds*layout.sampleRate) throw Error('The audible part is too short. Choose a longer excerpt.');
  const fade = {type:'fade',inFrames:Math.min(length,Math.round(layout.sampleRate*0.001)),
    outFrames:Math.min(length,Math.round(layout.sampleRate*0.004))};
  const recipe = [fade];
  const ops = [{type:'trim',...bounds},...recipe];
  if (layout.sampleRate!==playbackRate) ops.push({type:'rate',sampleRate:playbackRate});
  const {audio} = renderRecipe(input,ops);
  const analysis = analyzeSample(audio);
  const character = options.character && options.character!=='Auto' ? options.character : characterize(analysis);
  if (!Object.hasOwn(envelopePolicy,character)) throw Error('Choose a supported character.');
  const loop = options.sustain==='Off' || (character==='Plucked' && options.sustain!=='On') ? null : sustainLoop(audio,analysis);
  const envelope = {...envelopePolicy[character]};
  const peak = analysis.envelope.reduce((max,b)=>Math.max(max,b.rms),0);
  const attack = analysis.envelope.find(b=>b.rms>=attackFraction*peak);
  const decay = analysis.envelope.find(b=>b.start>attack.start && b.start<analysis.frames*0.85 && b.rms<=peak*decayFraction);
  // The recording already contains its attack. Limit any additional envelope shaping.
  const attackEstimated = !!attack && attack.start>0;
  if (attackEstimated) envelope.attackMs=Math.min(15,Math.max(1,Math.round(1000*attack.start/playbackRate)));
  if (decay) envelope.decayMs=Math.min(300,Math.max(5,Math.round(1000*(decay.start-attack.start)/playbackRate)));
  const gainDb = Math.min(0,Math.floor(chordPeakDb - 20*Math.log10(analysis.peak)));
  const wav = encodeSample(audio);
  return {wav,selection,recipe,character,loop,envelope,gainDb,inputPeak:measured.peak,inputRms:measured.rms,
    attackEstimated,decayEstimated:!!decay,pitch:analysis.pitch,frames:analysis.frames,channels:audio.channels};
}

export function proposalMap(sample, proposal, {id,name,rootNote}) {
  const pitched = proposal.pitch.root;
  const root = rootNote ?? pitched ?? (proposal.character==='Sustained'?null:60);
  if (!Number.isInteger(root) || root<0 || root>127) throw Error('Enter a root note from 0 to 127 to play this tone chromatically.');
  const instrument = mapSample(sample,root,{name,mode:proposal.loop?'gate':'oneShot'});
  const region = instrument.regions[0];
  if (rootNote==null && pitched===null) region.key=[root,root];
  Object.assign(region,{envelope:proposal.envelope,gainDb:proposal.gainDb,cents:root===pitched?-(proposal.pitch.cents??0):0});
  if (proposal.loop) region.loop=proposal.loop;
  return validateInstrument({...instrument,id});
}

export async function previewProposal(player, proposal, settings, signal) {
  const wav = proposal.wav;
  const bytes = await wav.arrayBuffer(), layout = await inspectWav(wav);
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  const hash = Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  const sample = {...layout,id:'excerpt',path:'Samples/Preview.wav',sha256:hash};
  const plan = compile(proposalMap(sample,proposal,settings));
  return stageWorkingSampler(player,{plan,samples:new Map([[sample.id,decodePCM(bytes,layout)]])},{signal});
}

export async function saveProposal(root, libraryId, source, proposal, settings) {
  const {selection,recipe,wav} = proposal;
  const operations = [{type:'trim',start:selection[0],end:selection[1]},...recipe];
  if (source.sampleRate!==playbackRate) operations.push({type:'rate',sampleRate:playbackRate});
  // Stable destination also permits retry after a failed draft write.
  const sample = await importOriginal(root,wav,'Samples/Processed/'+settings.id+'/excerpt.wav',{
    source:{path:source.path,sha256:source.sha256},license:source.license,
    recipe:{version:1,operations},provenance:{sourceProvenance:source.provenance??null,selection,
      pitch:proposal.pitch,character:proposal.character,inputPeak:proposal.inputPeak,inputRms:proposal.inputRms}});
  const instrument = proposalMap(sample,proposal,settings);
  const draft = createWorking({libraryId,source,selection,recipe,rendered:sample,instrument,
    rootNote:instrument.regions[0].root,name:settings.name});
  return saveWorking(root,draft);
}
