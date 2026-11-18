// SPDX-License-Identifier: GPL-3.0-only
import {RATE} from './daw-project.js';
const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const limit=512;
// All consumers use the same absolute audio-frame origin. -1 means silence.
export function timelineFrame(transport,frame){
  if(!transport.playing||frame<transport.startFrame)return -1;
  let position=transport.fromFrame+frame-transport.startFrame;
  if(transport.loop&&position>=transport.loopEnd)position=transport.loopStart+(position-transport.loopEnd)%(transport.loopEnd-transport.loopStart);
  return position<transport.length?position:-1;
}
const active=(map,e)=>{
  const key=e.part*128+e.note,old=map.get(key);
  if(e.velocity)map.set(key,{part:e.part,note:e.note,velocity:e.velocity,count:(old?.count||0)+1});
  else if(old){if(old.count>1)old.count--;else map.delete(key);}
};
// Each append is bounded; the worklet acknowledges it before another is sent.
// Chase, indexes and density are built incrementally, never in process().
export class ScheduleBuilder {
  constructor(data,capacity=8){
    if(!data||!integer(data.length,1,RATE*1200)||typeof data.loop!=='boolean')throw Error('Invalid DAW schedule');
    this.meta={length:data.length,loop:data.loop,fromFrame:data.fromFrame??0,loopStart:data.loopStart??0,loopEnd:data.loopEnd??data.length};
    const m=this.meta;if(!integer(m.fromFrame,0,m.length-1)||!integer(m.loopStart,0,m.length-1)||!integer(m.loopEnd,m.loopStart+1,m.length)||m.loop&&(m.loopEnd-m.loopStart<128||m.fromFrame<m.loopStart||m.fromFrame>=m.loopEnd))throw Error('Invalid playback interval (loop minimum: 128 frames)');
    Object.assign(this,{capacity,events:[],head:0,initial:new Map(),repeated:new Map(),initialIndex:null,loopIndex:null,seamTail:[]});
  }
  append(events){
    if(!Array.isArray(events)||events.length>1024||this.events.length+events.length>131072)throw Error('Invalid DAW event chunk');
    for(const e of events){
      const last=this.events.at(-1),m=this.meta;
      if(!e||!integer(e.frame,0,m.length)||last&&(e.frame<last.frame||e.frame===last.frame&&e.velocity===0&&last.velocity>0)||!integer(e.part,0,this.capacity-1)||!integer(e.note,0,127)||!integer(e.velocity,0,127))throw Error('Invalid DAW note event');
      if(e.velocity&&e.frame===m.length)throw Error('Note-on is outside the playback interval');
      this.events.push(e);while(this.events[this.head].frame<=e.frame-128)this.head++;
      if(this.events.length-this.head>limit)throw Error('DAW event density exceeds the audio budget');
      if(e.frame>=m.loopEnd-128&&e.frame<m.loopEnd)this.seamTail.push(e.frame-m.loopEnd);
      for(const [position,map,key] of [[m.fromFrame,this.initial,'initialIndex'],[m.loopStart,this.repeated,'loopIndex']]){
        if(e.frame<position||e.frame===position&&!e.velocity)active(map,e);
        else if(this[key]===null)this[key]=this.events.length-1;
      }
    }
  }
  finish(){
    const m=this.meta,n=this.events.length,initialIndex=this.initialIndex??n,loopIndex=this.loopIndex??n,initial=[...this.initial.values()],repeated=[...this.repeated.values()];
    for(const [at,index,notes] of [[m.fromFrame,initialIndex,initial],[m.loopStart,loopIndex,repeated]]){
      let count=notes.length;for(let i=index;i<n&&this.events[i].frame<at+128;i++)count++;
      if(count>limit)throw Error('Seek/chase density exceeds the audio budget');
    }
    if(m.loop){
      const seam=[...this.seamTail];
      seam.push(...repeated.map(()=>0));for(let i=loopIndex;i<n&&this.events[i].frame<Math.min(m.loopStart+128,m.loopEnd);i++)seam.push(this.events[i].frame-m.loopStart);
      seam.sort((a,b)=>a-b);for(let right=0,left=0;right<seam.length;right++){while(seam[left]<=seam[right]-128)left++;if(right-left+1>limit)throw Error('Loop seam density exceeds the audio budget');}
    }
    return {...m,events:this.events,initial,repeated,initialIndex,loopIndex};
  }
}
export function prepareSchedule(data,capacity=8){if(!Array.isArray(data?.events))throw Error('Invalid DAW events');const builder=new ScheduleBuilder(data,capacity);for(let i=0;i<data.events.length;i+=1024)builder.append(data.events.slice(i,i+1024));return builder.finish();}
