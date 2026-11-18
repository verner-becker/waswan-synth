// SPDX-License-Identifier: GPL-3.0-only
import {PPQ,RATE,uuid} from './daw-project.js';
export function inputFrame(context,timeStamp){
  const now=performance.now(),stamp=Number.isFinite(timeStamp)&&Math.abs(timeStamp-now)<5000?timeStamp:now,out=context.getOutputTimestamp?.();
  if(out&&Number.isFinite(out.contextTime)&&Number.isFinite(out.performanceTime)&&out.performanceTime>0&&Math.abs(out.performanceTime-now)<5000)return Math.round((out.contextTime+(stamp-out.performanceTime)/1000)*RATE);
  return Math.round((context.currentTime+(stamp-now)/1000)*RATE);
}
export class MidiTake {
  constructor(channel=null,{noteLimit=65536,eventLimit=65536,playbackBudget=131072}={}){Object.assign(this,{channel,noteLimit,eventLimit,playbackBudget});this.notes=[];this.held=new Map();this.sustained=Array.from({length:16},()=>new Set());this.pedal=Array(16).fill(false);this.events=[];this.count=0;}
  seed(state,frame){
    for(let ch=0;ch<16;ch++){if(this.channel!==null&&this.channel!==ch)continue;this.pedal[ch]=!!state.pedals?.[ch];const bend=state.bends?.[ch]||0,mod=state.mods?.[ch]||0;if(bend)this.input({frame,data:[224|ch,(bend+8192)&127,(bend+8192)>>7]});if(mod)this.input({frame,data:[176|ch,1,mod]});}
    for(const n of state.held||[])this.input({frame,data:[144|n.channel,n.pitch,n.velocity]});
  }
  close(channel,frame){for(const [key,n] of this.held)if(channel===null||key>>7===channel){n.off=frame;this.held.delete(key);}for(let ch=0;ch<16;ch++)if(channel===null||channel===ch){for(const n of this.sustained[ch])n.off=frame;this.sustained[ch].clear();}}
  input({data,frame,consumed=false}){
    if(consumed||!Number.isSafeInteger(frame)||!Array.isArray(data)||data.length!==3)return;const [status,pitch,value]=data,channel=status&15,kind=status&240,key=channel*128+pitch;
    if(status<128||status>=240||pitch<0||pitch>127||value<0||value>127||this.channel!==null&&channel!==this.channel)return;
    if(this.count>=131072)throw Error('MIDI take event budget exceeded');this.count++;
    if(kind===144&&value){if(this.notes.length>=this.noteLimit||2*(this.notes.length+1)+this.events.length>this.playbackBudget)throw Error('MIDI take note budget exceeded');const prior=this.held.get(key);if(prior)prior.off=frame;const n={pitch,channel,velocity:value,on:frame,off:null};this.notes.push(n);this.held.set(key,n);}
    else if(kind===128||kind===144){const n=this.held.get(key);if(n){this.held.delete(key);if(this.pedal[channel])this.sustained[channel].add(n);else n.off=frame;}}
    else if(kind===176&&pitch===64){this.pedal[channel]=value>=64;if(value<64){for(const n of this.sustained[channel])n.off=frame;this.sustained[channel].clear();}}
    else if(kind===176&&[120,123].includes(pitch))this.close(channel,frame);
    else if(kind===224||kind===176&&pitch===1){if(this.events.length>=this.eventLimit||2*this.notes.length+this.events.length+1>this.playbackBudget)throw Error('MIDI take expression budget exceeded');this.events.push({frame,channel,type:kind===224?'bend':'mod',value:kind===224?(pitch|(value<<7))-8192:value});}
  }
  clip({trackId,name,startFrame,endFrame,fromFrame,bpm,offsetMs=0}){
    if(endFrame<=startFrame)throw Error('Recording cancelled before the first beat');const ratio=bpm*PPQ/(RATE*60),offset=offsetMs*RATE/1000,length=Math.max(1,Math.round((endFrame-startFrame)*ratio)),notes=[];
    for(const n of this.notes){const rawEnd=n.off??endFrame;if(n.on>=endFrame||rawEnd<=startFrame)continue;const on=Math.round((Math.max(n.on,startFrame)-startFrame-offset)*ratio),off=Math.round((Math.min(rawEnd,endFrame)-startFrame-offset)*ratio),start=Math.max(0,on),end=Math.min(length,Math.max(start+1,off));if(on>=length||off<0||off===0&&on<0)continue;notes.push({id:uuid(),pitch:n.pitch,channel:n.channel,velocity:n.velocity,start,duration:end-start});}
    const midiEvents=[],prior=new Map();for(const e of this.events){if(e.frame>=endFrame)continue;const tick=Math.round((e.frame-startFrame-offset)*ratio);if(tick<0)prior.set(e.channel+':'+e.type,e);else if(tick<length)midiEvents.push({id:uuid(),tick,type:e.type,channel:e.channel,value:e.value});}
    const initial=[...prior.values()].sort((a,b)=>a.frame-b.frame).map(e=>({id:uuid(),tick:0,type:e.type,channel:e.channel,value:e.value}));
    return {id:uuid(),type:'midi',trackId,name,position:{unit:'ticks',value:Math.max(0,Math.round(fromFrame*ratio))},length,loopLength:length,loop:false,notes,midiEvents:[...initial,...midiEvents]};
  }
}
