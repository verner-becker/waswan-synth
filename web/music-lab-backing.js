// SPDX-License-Identifier: GPL-3.0-only
import {pitchLabel,pitchMidi,transposeLesson} from './music-lab-model.js';

// Kept in the AudioWorklet realm alongside the owner transport.
export const labBackingClock={playing:false};
export function loopFrame(elapsed,duration) {
  if(elapsed<0)return -1;
  return elapsed-Math.round(Math.floor((elapsed+.499999)/duration)*duration);
}
const BEAT=480,BAR=BEAT*4;
const C=['C3','G3','C4 E4 G4',''],G=['G2','D3','G3 B3 D4',''];
const AM=['A2','E3','A3 C4 E4','m'],F=['F2','C3','F3 A3 C4',''];
const forms={pop:{tonic:'C',mode:'major',bars:[C,G,AM,F]},minor:{tonic:'A',mode:'minor',bars:[AM,AM,F,F]}};

function pitch(text) {
  const [,step,accidental,octave]=/^([A-G])([#b]?)(\d)$/.exec(text);
  const data={step,alter:accidental==='#'?1:accidental==='b'?-1:0,octave:Number(octave)};
  return {...data,midi:pitchMidi(data)};
}

export function backingPlan({form,tonic,style,bpm,bar=0}) {
  const source=forms[form];
  if(!source||!['click','bass','harmony'].includes(style))throw Error('Invalid Music Lab backing');
  const notes=[],harmony=[];
  const shift=p=>transposeLesson({key:{tonic:source.tonic,mode:source.mode},notes:[{pitch:pitch(p)}]},tonic).notes[0].pitch;
  const bars=bar?source.bars.slice(bar-1,bar):source.bars;
  if(!bars.length)throw Error('Invalid backing bar');
  const add=(midi,startTick,durationTick,velocity)=>notes.push({midi,startTick,durationTick,velocity});
  bars.forEach(([root,fifth,triad,quality],index)=>{
    const down=shift(root),start=index*BAR,pitches=triad.split(' ').map(note=>shift(note).midi);
    harmony.push({tick:start,label:pitchLabel(down).replace(/-?\d+$/,'')+quality,classes:pitches.map(midi=>midi%12)});
    if(style==='click')return;
    add(down.midi,start,BEAT,103);
    add(shift(fifth).midi,start+2*BEAT,BEAT,91);
    if(style==='harmony')for(const [beat,velocity] of [[1,75],[3,69]])
      for(const midi of pitches)add(midi,start+beat*BEAT,BEAT/2,velocity);
  });
  return {notes,harmony,bpm,ppq:BEAT,lengthTick:bars.length*BAR,loop:true};
}

export function harmonyAt(plan,tick) {
  if(!Number.isFinite(tick)||tick<0)return null;
  const position=tick%plan.lengthTick;
  return plan.harmony.findLast(chord=>chord.tick<=position)??null;
}

export function observedHarmony(plan,startFrame,stamp,context,now=performance.now()) {
  const output=context?.getOutputTimestamp?.();
  if(!Number.isFinite(startFrame)||!Number.isFinite(stamp)||Math.abs(now-stamp)>500||
    !output||!Number.isFinite(output.performanceTime)||output.performanceTime<=0||Math.abs(now-output.performanceTime)>500||
    !Number.isFinite(output.contextTime))return null;
  const frame=(output.contextTime+(stamp-output.performanceTime)/1000)*context.sampleRate;
  const tick=(frame-startFrame)*plan.bpm*plan.ppq/(context.sampleRate*60);
  if(tick<0)return null;
  // Near a chord boundary, the estimated device/output offset is too coarse to label the attack.
  const within=tick%BAR,guard=plan.bpm*plan.ppq*.075/60;
  return within>guard&&within<BAR-guard?harmonyAt(plan,tick):null;
}
