// SPDX-License-Identifier: GPL-3.0-only
import {controlKey} from './daw-sampler-midi.js';
// Source notes remain intact. This bounded view is shared by playback and editing.
export function midiWindow(clip,limit=131072){
  const offset=clip.offsetTicks||0,end=offset+clip.length,period=clip.loopLength,first=clip.loop?Math.floor(offset/period):0,last=clip.loop?Math.ceil(end/period):1,notes=[],events=[],prior=new Map();let budget=0;
  if(!clip.loop&&offset>=period)return {notes,events};
  for(const [order,e] of (clip.midiEvents||[]).entries()){let tick=(clip.loop?first*period:0)+e.tick;if(tick>=offset&&clip.loop&&first>0)tick-=period;if(tick<offset){const key=controlKey(e),old=prior.get(key);if(!old||tick>=old.at)prior.set(key,{...e,at:tick,order,tick:0});}}
  for(const e of [...prior.values()].sort((a,b)=>a.at-b.at||a.order-b.order)){if(++budget>limit)throw Error('MIDI window event budget exceeded');const {at,order,...value}=e;events.push(value);}
  if(!clip.notes.length&&!clip.midiEvents?.length)return {notes,events};
  for(let cycle=first;cycle<last;cycle++){
    const base=cycle*period;
    for(const n of clip.notes){const start=base+n.start,stop=start+n.duration;if(start>=end||stop<=offset)continue;if((budget+=2)>limit)throw Error('MIDI window event budget exceeded');const at=Math.max(start,offset),to=Math.min(stop,end);notes.push({...n,start:at-offset,duration:to-at});}
    if(!clip.loop&&offset>=period)return {notes,events};
  for(const [order,e] of (clip.midiEvents||[]).entries()){const at=base+e.tick;if(at<offset||at>=end)continue;if(++budget>limit)throw Error('MIDI window event budget exceeded');events.push({...e,tick:at-offset});}
  }
  events.sort((a,b)=>a.tick-b.tick);return {notes,events};
}
