// SPDX-License-Identifier: GPL-3.0-only
import {MAX_FRAMES} from './studio-format.js';
import {validateAutomation,automationValue} from './studio-automation.js';
// Transport positions follow audio frames. UI timers never trigger musical events.
export class StudioClock {
  constructor(note,notify=()=>{},parameter=()=>true,expression=()=>true){this.note=note;this.notify=notify;this.parameter=parameter;this.expression=expression;this.active=false;this.held=new Map();this.pedals=new Uint8Array(4);this.deferred=new Set();}
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
    const bpm=data.bpm??120;if(!Number.isInteger(bpm)||bpm<40||bpm>240)throw Error('Invalid playback tempo');
    const ticks=data.ticks??Math.round(data.length*bpm*960/(44100*60));if(!Number.isSafeInteger(ticks)||ticks<1||ticks>960*4096)throw Error('Invalid sequence tick length');
    validateAutomation(data.automation,ticks);
    const expression=data.expression||[];if(!Array.isArray(expression)||expression.length>10004)throw Error('Expression event limit exceeded');
    previous=-1;for(const e of expression){const d=e.data;if(!Number.isSafeInteger(e.frame)||e.frame<0||e.frame<previous||e.frame>data.length||!Array.isArray(d)||d.length!==3||!d.every(Number.isInteger)||d[0]<128||d[0]>=240||![176,224].includes(d[0]&240)||d[1]<0||d[1]>127||d[2]<0||d[2]>127)throw Error('Invalid expression event');previous=e.frame;}
    const pedalLane=data.automation?.find(l=>l.target==='sequence-sustain');
    const controllers=expression.filter(e=>!pedalLane||e.data[1]!==64||(e.data[0]&240)!==176).map(e=>({frame:e.frame,data:e.data}));
    if(pedalLane)for(const p of pedalLane.points)for(let part=0;part<4;part++)controllers.push({frame:Math.round(p.tick*44100*60/(bpm*960)),data:[176|part,64,p.value]});
    controllers.sort((a,b)=>a.frame-b.frame);
    const density=new Map();for(const e of [...data.events,...controllers]){const block=Math.floor(e.frame/128),count=(density.get(block)||0)+1;if(count>512)throw Error('Sequence block event limit exceeded');density.set(block,count);}
    this.stop('replaced');this.events=data.events;this.controllers=controllers;this.automation=(data.automation||[]).filter(l=>l.target!=='sequence-sustain');this.bpm=bpm;this.ticks=ticks;this.expressionIndex=0;this.length=data.length;this.duration=duration;this.loop=data.loop;this.startFrame=frame;this.cycle=0;this.index=0;this.active=true;this.lastNotify=frame;
    this.notify({playing:true,frame:0,cycle:0,reason:'started'});
  }
  release(){for(const key of this.held.keys())this.note(Math.floor(key/128),key%128,0);this.held.clear();this.deferred.clear();this.pedals.fill(0);}
  pedal(part,value){
    this.pedals[part]=value>=64?1:0;
    if(!this.pedals[part])for(const key of [...this.deferred])if(Math.floor(key/128)===part&&!(this.held.get(key)>0)){this.note(part,key%128,0);this.deferred.delete(key);this.held.delete(key);}
  }
  controller(data){
    const [status,a,b]=data,part=status&15;if(part>=4)return;
    if((status&240)===224)return this.expression('midi-pitch-bend',(a|(b<<7))-8192);
    else if(a===1)return this.expression('modulation',b);
    else if(a===64)this.pedal(part,b);
    else if(a===120||a===123)for(const key of [...this.held.keys()])if(Math.floor(key/128)===part){this.note(part,key%128,0);this.held.delete(key);this.deferred.delete(key);}
  }
  stop(reason='user'){if(!this.active)return;this.release();this.active=false;this.notify({playing:false,frame:0,cycle:this.cycle,reason});}
  tick(frame){
    if(!this.active||frame<this.startFrame)return;
    const elapsed=frame-this.startFrame,cycle=Math.floor((elapsed+.499999)/this.duration);
    if(cycle>this.cycle){
      if(!this.loop){
        while(this.expressionIndex<this.controllers.length){if(this.controller(this.controllers[this.expressionIndex++].data)===false){this.stop('expression-unavailable');return;}}
        for(const lane of this.automation)if(!this.parameter(lane.target,automationValue(lane,this.ticks))){this.stop('automation-unavailable');return;}
        this.release();this.active=false;this.notify({playing:false,frame:this.length,cycle:0,reason:'ended'});return;
      }
      this.release();
      this.cycle=cycle;this.index=0;this.expressionIndex=0;
    }
    const relative=elapsed-Math.round(this.cycle*this.duration);
    while((this.index<this.events.length&&this.events[this.index].frame<=relative)||(this.expressionIndex<this.controllers.length&&this.controllers[this.expressionIndex].frame<=relative)){
      const control=this.controllers[this.expressionIndex],next=this.events[this.index];
      if(control&&control.frame<=relative&&(!next||control.frame<=next.frame)){if(this.controller(control.data)===false){this.stop('expression-unavailable');return;}this.expressionIndex++;continue;}
      const e=this.events[this.index++],key=e.part*128+e.note;
      if(e.velocity){this.deferred.delete(key);this.held.set(key,(this.held.get(key)||0)+1);if(!this.note(e.part,e.note,e.velocity)){this.stop('instrument-unavailable');return;}}
      else{const count=(this.held.get(key)||0)-1;if(count>0)this.held.set(key,count);else if(this.pedals[e.part]){this.held.set(key,0);this.deferred.add(key);}else{this.held.delete(key);this.note(e.part,e.note,0);}}
    }
    const tick=relative*this.bpm*960/(44100*60);
    for(const lane of this.automation)if(!this.parameter(lane.target,automationValue(lane,tick))){this.stop('automation-unavailable');return;}
    if(frame-this.lastNotify>=1764){this.lastNotify=frame;this.notify({playing:true,frame:relative,cycle:this.cycle});}
  }
}
