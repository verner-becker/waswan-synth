// SPDX-License-Identifier: GPL-3.0-only
import {RATE} from './daw-project.js';
import {legacyExpression,validPerformanceControl} from './daw-sampler-midi.js';
const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const limit=512;
export const eventPriority=e=>e.type?1:e.velocity?2:0;
// Negative IDs distinguish overlapping sampler gestures from legacy part/pitch keys.
export const heldKey=e=>e.noteId===undefined?e.part*128+e.note:-e.noteId;
// All consumers use the same absolute audio-frame origin. -1 means silence.
export function timelineFrame(transport,frame){
  if(!transport.playing||frame<transport.startFrame)return -1;
  let position=transport.fromFrame+frame-transport.startFrame;
  if(transport.loop&&position>=transport.loopEnd)position=transport.loopStart+(position-transport.loopEnd)%(transport.loopEnd-transport.loopStart);
  return position<transport.length?position:-1;
}
export function updateHeldNotes(map,pedals,e,samplerState){
  const channelKey=e.part*16+e.channel;
  if(e.type){
    if(e.type!=='cc')return;
    if(e.controller===64&&e.value>=64){pedals.add(channelKey);return;}
    if(![64,120,123].includes(e.controller))return;
    pedals.delete(channelKey);
    for(const [key,note] of map){
      if(note.part===e.part&&note.channel===e.channel&&(note.released||e.controller!==64))map.delete(key);
    }
    return;
  }
  const key=heldKey(e),old=map.get(key);
  if(e.velocity){const held={part:e.part,note:e.note,velocity:e.velocity,count:(old?.count||0)+1};
    if(e.noteId!==undefined){held.noteId=e.noteId;held.channel=e.channel;}
    if(samplerState!==undefined)held.samplerState=samplerState;
    map.set(key,held);}
  else if(old){
    if(old.count>1)map.set(key,{...old,count:old.count-1});
    else if(e.noteId!==undefined&&pedals.has(channelKey))map.set(key,{...old,released:true});
    else map.delete(key);
  }
}
const chaseCost=notes=>notes.reduce((count,note)=>count+(note.released?2:1),0);
// Each append is bounded; the worklet acknowledges it before another is sent.
// Chase, indexes and density are built incrementally, never in process().
export class ScheduleBuilder {
  constructor(data,capacity=8){
    if(!data||!integer(data.length,1,RATE*1200)||typeof data.loop!=='boolean')throw Error('Invalid DAW schedule');
    this.meta={length:data.length,loop:data.loop,fromFrame:data.fromFrame??0,loopStart:data.loopStart??0,loopEnd:data.loopEnd??data.length};
    const m=this.meta;if(!integer(m.fromFrame,0,m.length-1)||!integer(m.loopStart,0,m.length-1)||!integer(m.loopEnd,m.loopStart+1,m.length)||m.loop&&(m.loopEnd-m.loopStart<128||m.fromFrame<m.loopStart||m.fromFrame>=m.loopEnd))throw Error('Invalid playback interval (loop minimum: 128 frames)');
    Object.assign(this,{capacity,events:[],head:0,initial:new Map(),repeated:new Map(),initialExpr:new Map(),loopExpr:new Map(),initialPedals:new Set(),loopPedals:new Set(),initialIndex:null,loopIndex:null,seamTail:[]});
  }
  append(events){
    if(!Array.isArray(events)||events.length>1024||this.events.length+events.length>131072)throw Error('Invalid DAW event chunk');
    for(const e of events){
      const last=this.events.at(-1),m=this.meta;
      if(!e||!integer(e.frame,0,m.length)||last&&(e.frame<last.frame||e.frame===last.frame&&eventPriority(e)<eventPriority(last))||!integer(e.part,0,this.capacity-1))throw Error('Invalid DAW event');
      if(e.type){
        const legacy=e.channel===undefined;
        if(legacy&&!legacyExpression(e.type)||!validPerformanceControl(legacy?{...e,channel:0}:e))throw Error('Invalid DAW expression event');
      }
      else if(!integer(e.note,0,127)||!integer(e.velocity,0,127))throw Error('Invalid DAW note event');
      if(e.noteId!==undefined&&(!integer(e.noteId,1,131072)||!integer(e.channel,0,15)))throw Error('Invalid sampler gesture');
      if((e.type||e.velocity)&&e.frame===m.length)throw Error('Event is outside the playback interval');
      this.events.push(e);while(this.events[this.head].frame<=e.frame-128)this.head++;
      if(this.events.length-this.head>limit)throw Error('DAW event density exceeds the audio budget');
      if(e.frame>=m.loopEnd-128&&e.frame<m.loopEnd)this.seamTail.push(e.frame-m.loopEnd);
      for(const [position,map,key,expression,pedals] of [[m.fromFrame,this.initial,'initialIndex',this.initialExpr,this.initialPedals],[m.loopStart,this.repeated,'loopIndex',this.loopExpr,this.loopPedals]]){
        if(e.type&&e.channel===undefined&&e.frame<=position){const state=expression.get(e.part)||{part:e.part,bend:0,mod:0};state[e.type]=e.value;expression.set(e.part,state);}
        else if(e.frame<position||e.frame===position&&!e.type&&!e.velocity)updateHeldNotes(map,pedals,e);
        else if(this[key]===null)this[key]=this.events.length-1;
      }
    }
  }
  finish(){
    const m=this.meta,n=this.events.length,initialIndex=this.initialIndex??n,loopIndex=this.loopIndex??n,initial=[...this.initial.values()],repeated=[...this.repeated.values()],initialExpression=[...this.initialExpr.values()],loopExpression=[...this.loopExpr.values()];
    for(const [at,index,notes,expression] of [[m.fromFrame,initialIndex,initial,initialExpression],[m.loopStart,loopIndex,repeated,loopExpression]]){
      let count=chaseCost(notes)+expression.length;for(let i=index;i<n&&this.events[i].frame<at+128;i++)count++;
      if(count>limit)throw Error('Seek/chase density exceeds the audio budget');
    }
    if(m.loop){
      const seam=[...this.seamTail];
      seam.push(...Array(chaseCost(repeated)+loopExpression.length).fill(0));for(let i=loopIndex;i<n&&this.events[i].frame<Math.min(m.loopStart+128,m.loopEnd);i++)seam.push(this.events[i].frame-m.loopStart);
      seam.sort((a,b)=>a-b);for(let right=0,left=0;right<seam.length;right++){while(seam[left]<=seam[right]-128)left++;if(right-left+1>limit)throw Error('Loop seam density exceeds the audio budget');}
    }
    return {...m,events:this.events,initial,repeated,initialExpression,loopExpression,initialIndex,loopIndex};
  }
}
export function prepareSchedule(data,capacity=8){if(!Array.isArray(data?.events))throw Error('Invalid DAW events');const builder=new ScheduleBuilder(data,capacity);for(let i=0;i<data.events.length;i+=1024)builder.append(data.events.slice(i,i+1024));return builder.finish();}
