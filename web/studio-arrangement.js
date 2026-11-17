// SPDX-License-Identifier: GPL-3.0-only
import {PPQ,validateSequence,inputNotes} from './studio-sequence.js';
import {RATE} from './studio-format.js';
export const defaultTracks=()=>Array.from({length:4},(_,part)=>({part,level:100,pan:0,mute:false,solo:false}));
const barTicks=s=>s.meter[0]*PPQ*4/s.meter[1];
const grow=(s,end)=>{const bar=barTicks(s);s.length=Math.max(s.length,Math.ceil(end/bar)*bar);};
export function makeClip(sequence,part){
  const s=structuredClone(sequence),notes=s.notes.filter(n=>n.part===part&&!n.clip);if(!notes.length)throw Error('Create ungrouped notes in this part first');
  const bar=barTicks(s),start=Math.floor(Math.min(...notes.map(n=>n.start))/bar)*bar,end=Math.ceil(Math.max(...notes.map(n=>n.start+n.duration))/bar)*bar;
  grow(s,end);const clip={id:crypto.randomUUID(),name:'Clip '+((s.clips?.length||0)+1),part,start,length:end-start};
  (s.clips??=[]).push(clip);for(const n of notes)n.clip=clip.id;return validateSequence(s);
}
export function moveClip(sequence,id,start,part){
  const s=structuredClone(sequence),clip=s.clips?.find(c=>c.id===id);if(!clip)throw Error('Select a clip');
  if(!Number.isSafeInteger(start)||start<0||!Number.isInteger(part)||part<0||part>3)throw Error('Invalid clip destination');
  const delta=start-clip.start;clip.start=start;clip.part=part;grow(s,start+clip.length);
  for(const n of s.notes)if(n.clip===id){n.start+=delta;n.part=part;}
  return validateSequence(s);
}
export function duplicateClip(sequence,id){
  const clip=sequence.clips?.find(c=>c.id===id);if(!clip)throw Error('Select a clip');
  const s=structuredClone(sequence),copy={...clip,id:crypto.randomUUID(),name:(clip.name+' copy').slice(0,48),start:clip.start+clip.length};
  grow(s,copy.start+copy.length);s.clips.push(copy);
  for(const n of sequence.notes.filter(n=>n.clip===id))s.notes.push({...n,id:crypto.randomUUID(),clip:copy.id,start:n.start+clip.length});
  return validateSequence(s);
}
export function deleteClip(sequence,id){const s=structuredClone(sequence);s.notes=s.notes.filter(n=>n.clip!==id);s.clips=s.clips.filter(c=>c.id!==id);return validateSequence(s);}
export function addTake(sequence,project,part,offsetFrames=0){
  const imported=inputNotes(project,part),s=structuredClone(sequence),ratio=s.bpm/imported.bpm;
  const shift=offsetFrames*s.bpm*PPQ/(RATE*60);let added=0;
  for(const n of imported.notes){
    let start=Math.round(n.start*ratio+shift),duration=Math.max(1,Math.round(n.duration*ratio));if(start<0){duration+=start;start=0;if(duration<1)continue;}
    if(s.loop){start%=s.length;duration=Math.min(duration,s.length-start);}else grow(s,start+duration);
    s.notes.push({...n,id:crypto.randomUUID(),start,duration});added++;
  }
  for(const e of imported.expression||[]){let tick=Math.max(0,Math.round(e.tick*ratio+shift));if(s.loop)tick%=s.length;else grow(s,tick);(s.expression??=[]).push({...e,tick});}
  if(!added)throw Error('No external MIDI notes to add in this interval');return validateSequence(s);
}
