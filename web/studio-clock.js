// SPDX-License-Identifier: GPL-3.0-only
import {MAX_FRAMES} from './studio-format.js';
// Transport positions follow audio frames. UI timers never trigger musical events.
export class StudioClock {
  constructor(note,notify=()=>{}){this.note=note;this.notify=notify;this.active=false;this.held=new Map();}
  start(data,frame){
    if(!data||!Array.isArray(data.events)||data.events.length>8192||!Number.isSafeInteger(data.length)||data.length<1||data.length>MAX_FRAMES||typeof data.loop!=='boolean')throw Error('Invalid sequence schedule');
    const duration=data.duration??data.length;
    if(!Number.isFinite(duration)||duration<1||duration>MAX_FRAMES||Math.abs(duration-data.length)>.51)throw Error('Invalid loop duration');
    let previous=-1,lastBlock=-1,count=0;
    for(const e of data.events){
      if(!Number.isSafeInteger(e.frame)||e.frame<0||e.frame<previous||e.frame>data.length||!Number.isInteger(e.part)||e.part<0||e.part>3||!Number.isInteger(e.note)||e.note<0||e.note>127||!Number.isInteger(e.velocity)||e.velocity<0||e.velocity>127)throw Error('Invalid scheduled note');
      previous=e.frame;
      const block=Math.floor(e.frame/128);if(block!==lastBlock){lastBlock=block;count=0;}if(++count>512)throw Error('Sequence block event limit exceeded');
    }
    this.stop('replaced');this.events=data.events;this.length=data.length;this.duration=duration;this.loop=data.loop;this.startFrame=frame;this.cycle=0;this.index=0;this.active=true;this.lastNotify=frame;
    this.notify({playing:true,frame:0,cycle:0,reason:'started'});
  }
  release(){for(const key of this.held.keys())this.note(Math.floor(key/128),key%128,0);this.held.clear();}
  stop(reason='user'){if(!this.active)return;this.release();this.active=false;this.notify({playing:false,frame:0,cycle:this.cycle,reason});}
  tick(frame){
    if(!this.active||frame<this.startFrame)return;
    const elapsed=frame-this.startFrame,cycle=Math.floor((elapsed+.499999)/this.duration);
    if(cycle>this.cycle){
      this.release();if(!this.loop){this.active=false;this.notify({playing:false,frame:this.length,cycle:0,reason:'ended'});return;}
      this.cycle=cycle;this.index=0;
    }
    const relative=elapsed-Math.round(this.cycle*this.duration);
    while(this.index<this.events.length&&this.events[this.index].frame<=relative){
      const e=this.events[this.index++],key=e.part*128+e.note;
      if(e.velocity){this.held.set(key,(this.held.get(key)||0)+1);if(!this.note(e.part,e.note,e.velocity)){this.stop('instrument-unavailable');return;}}
      else{const count=(this.held.get(key)||0)-1;if(count>0)this.held.set(key,count);else{this.held.delete(key);this.note(e.part,e.note,0);}}
    }
    if(frame-this.lastNotify>=1764){this.lastNotify=frame;this.notify({playing:true,frame:relative,cycle:this.cycle});}
  }
}
