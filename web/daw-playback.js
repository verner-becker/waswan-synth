// SPDX-License-Identifier: GPL-3.0-only
import {RATE,PPQ,clipSeconds,clipDuration,validateProject} from './daw-project.js';
import {prepareSchedule,timelineFrame} from './daw-transport.js';
// Shared only inside one AudioWorkletGlobalScope. The main-thread import has its
// own copy and cannot change the audio gate through UI state.
export const audioTransport={playing:false,startFrame:0};
export const trackAudible=(project,track)=>!track.mute&&(!project.tracks.some(t=>t.solo)||track.solo);
// Logical track IDs are assigned on playback; no firmware part number is saved.
export function assignSlots(project,capacity=8){
  const midi=project.tracks.filter(t=>t.type==='midi'&&t.instrument),slots=new Map(),used=new Set();
  if(midi.length>capacity)throw Error(`This build supports ${capacity} simultaneous instruments`);
  for(const track of midi.filter(t=>t.instrument.type==='drumx')){
    const part=[0,1,2,3].find(p=>!used.has(p));if(part===undefined)throw Error('DRUM-X supports four simultaneous instrument parts with its existing shared hit budget');slots.set(track.id,part);used.add(part);
  }
  // Extra slots first, retaining the live Synth parts whenever possible.
  const order=[...Array.from({length:Math.max(0,capacity-4)},(_,i)=>i+4),0,1,2,3].filter(p=>p<capacity);
  for(const track of midi.filter(t=>t.instrument.type!=='drumx')){const part=order.find(p=>!used.has(p));slots.set(track.id,part);used.add(part);}
  return slots;
}
export function compileProject(project,slots=assignSlots(project)){
  validateProject(project);const events=[],audio=[],base=project.length*60/(project.bpm*PPQ);let duration=base;
  for(const clip of project.clips){
    const track=project.tracks.find(t=>t.id===clip.trackId),start=clipSeconds(clip,project.bpm),seconds=clipDuration(clip,project.bpm);duration=Math.max(duration,start+seconds);
    // Muting is a mixer operation. Keep schedules alive so unmuting does not
    // require restarting clocks, sources or the instrument.
    if(clip.type==='audio'){audio.push({clip,track,start,seconds});continue;}
    const part=slots.get(track.id);if(part===undefined&&clip.notes.length)throw Error('Choose an instrument for '+track.name);if(part===undefined)continue;
    const count=clip.loop?Math.ceil(clip.length/clip.loopLength):1;
    for(let repeat=0;repeat<count;repeat++)for(const n of clip.notes){
      const tick=repeat*clip.loopLength+n.start;if(tick>=clip.length)continue;
      const on=Math.round((start+tick*60/(project.bpm*PPQ))*RATE),off=Math.round((start+(tick+Math.min(n.duration,clip.length-tick))*60/(project.bpm*PPQ))*RATE);
      events.push({frame:on,part,note:n.pitch,velocity:n.velocity},{frame:Math.max(on+1,off),part,note:n.pitch,velocity:0});
      if(events.length>131072)throw Error('Playback event budget exceeded; reduce clip repetitions');
    }
  }
  const length=Math.ceil(duration*RATE);if(length<1||length>RATE*1200)throw Error('Playback supports at most 20 minutes');
  events.sort((a,b)=>a.frame-b.frame||a.velocity-b.velocity);
  const density=new Map();for(const e of events){const block=Math.floor(e.frame/128),count=(density.get(block)||0)+1;if(count>512)throw Error('DAW event density exceeds the audio budget');density.set(block,count);}
  return {events,audio,length,duration:length,loop:false,slots};
}
// Runs in AudioWorklet. No UI timer schedules notes. Frame notifications are UI only.
export class DawClock {
  constructor(note,stop,notify=()=>{},capacity=8){Object.assign(this,{note,stopNotes:stop,notify,capacity});this.active=false;this.held=new Map();}
  start(data,frame){this.startPrepared(prepareSchedule(data,this.capacity),frame);}
  startPrepared(data,frame){
    if(!Number.isSafeInteger(frame)||frame<0)throw Error('Invalid DAW start frame');
    this.stop('replaced');Object.assign(this,data);this.startFrame=frame;this.index=data.initialIndex;this.pendingChase=data.initial;this.cycle=0;this.lastNotify=frame;this.active=true;this.position=data.fromFrame;this.notify({playing:true,frame:this.position,startFrame:frame,reason:'started'});
  }
  stop(reason='user'){if(!this.active)return;this.stopNotes();this.held.clear();this.active=false;this.notify({playing:false,frame:this.position||0,reason});}
  dispatch(until,inclusive,count){
    while(this.index<this.events.length&&(inclusive?this.events[this.index].frame<=until:this.events[this.index].frame<until)){
      if(++count>512){this.stop('clock-event-budget');return count;}
      const e=this.events[this.index++],key=e.part*128+e.note;
      if(e.velocity){this.held.set(key,(this.held.get(key)||0)+1);if(!this.note(e.part,e.note,e.velocity)){this.stop('instrument-unavailable');return count;}}
      else if(this.held.has(key)){const n=this.held.get(key)-1;if(n>0)this.held.set(key,n);else{this.held.delete(key);this.note(e.part,e.note,0);}}
    }
    return count;
  }
  tick(frame){
    if(!this.active||frame<this.startFrame)return;
    const elapsed=frame-this.startFrame,absolute=this.fromFrame+elapsed,cycle=this.loop&&absolute>=this.loopEnd?1+Math.floor((absolute-this.loopEnd)/(this.loopEnd-this.loopStart)):0;
    if(!this.loop&&absolute>=this.length){this.position=this.length;this.dispatch(this.length,true,0);if(this.active)this.stop('ended');return;}
    let dispatched=0;
    if(cycle>this.cycle){
      if(cycle>this.cycle+1){this.stop('clock-gap');return;}
      // Preserve events in the remaining fraction of the previous quantum.
      // MIDI is quantum/buffer bounded; do not silently drop the right edge.
      dispatched=this.dispatch(this.loopEnd,false,dispatched);if(!this.active)return;
      this.stopNotes();this.held.clear();
      this.cycle=cycle;this.index=this.loopIndex;this.pendingChase=this.repeated;
    }
    const relative=timelineFrame({playing:true,startFrame:this.startFrame,fromFrame:this.fromFrame,length:this.length,loop:this.loop,loopStart:this.loopStart,loopEnd:this.loopEnd},frame);this.position=relative;
    if(this.pendingChase){for(const n of this.pendingChase){if(++dispatched>512){this.stop('clock-event-budget');return;}this.held.set(n.part*128+n.note,n.count);if(!this.note(n.part,n.note,n.velocity)){this.stop('instrument-unavailable');return;}}this.pendingChase=null;}
    this.dispatch(relative,true,dispatched);if(!this.active)return;
    if(frame-this.lastNotify>=1764){this.lastNotify=frame;this.notify({playing:true,frame:relative,cycle:this.cycle,startFrame:this.startFrame});}
  }
}
