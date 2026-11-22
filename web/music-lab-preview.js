// SPDX-License-Identifier: GPL-3.0-only
import {demoSchedule} from './music-lab-model.js';
import {StudioClock} from './studio-clock.js';
import {labBackingClock} from './music-lab-backing.js';

const PARTS=[0,1,2,3];
const TAKE_PRIORITY=new Set([
  'panic','reboot','tone-bank-load','instrument-setup','studio-events-connect',
  'studio-context-apply','studio-sequence-start','daw-apply','daw-start',
  'daw-live-open','daw-preview-open','daw-export-open','daw-sampler-live',
  'daw-tape-commit','daw-tape-live'
]);

export function interruptsPreview(message) {
  return TAKE_PRIORITY.has(message.t)||
    (message.t==='btn'&&message.down&&[16,17].includes(message.b))||
    (message.t==='midi'&&(message.st&240)===176&&[120,123].includes(message.d1));
}

export class MusicLabPreview {
  constructor({engine,conflict,layered,notify}) {
    Object.assign(this,{engine,conflict,layered,notify});
    this.sounding=new Set();
    this.clock=new StudioClock((part,note,velocity)=>{
      if(!velocity){
        if(!this.sounding.delete(note))return true;
        return !!this.engine()?.waswan_studio_note(part,note,0);
      }
      if(this.backing&&this.level===0)return true;
      const attack=this.backing?Math.max(1,Math.round(velocity*this.level/100)):velocity;
      const applied=!!this.engine()?.waswan_studio_note(part,note,attack);
      if(applied)this.sounding.add(note);
      return applied;
    },state=>{
      if(this.backing&&!state.playing)labBackingClock.playing=false;
      this.notify({t:'music-lab-state',token:this.token,part:this.part,startFrame:this.startFrame,...state});
    });
  }

  eligible(x,part) {
    return x.sim_engine(part)===0&&x.waswan_mode(part)<=1&&
      x.waswan_part_limit(part)===x.waswan_voice_limit()&&
      x.waswan_studio_mix_value(part,0)>0&&!x.waswan_studio_mix_value(part,6)&&
      (!PARTS.some(p=>x.waswan_studio_mix_value(p,7))||x.waswan_studio_mix_value(part,7))&&
      (part!==0||!this.layered());
  }

  start(message,frame,rate) {
    const {token}=message;
    if(typeof token!=='string'||!/^[-\w]{1,80}$/.test(token))return;
    const reject=reason=>this.notify({t:'music-lab-state',token,playing:false,reason});
    const x=this.engine();
    if(!x?.waswan_studio_note||!x.waswan_part_limit||x.sim_midi_mode?.())return reject('audio-unavailable');
    if(this.conflict())return reject('busy');
    const backing=message.backing===true,level=message.level??70;
    if(backing&&(!message.loop||!Number.isInteger(level)||level<0||level>100))return reject('invalid-demo');
    const hasNotes=Array.isArray(message.notes)&&message.notes.length>0;
    const part=hasNotes?[x.sim_track(),...PARTS].find(part=>this.eligible(x,part)):undefined;
    if(hasNotes&&part===undefined)return reject('no-part');
    const transpose=x.sim_seq_transpose();
    try{
      const plan=demoSchedule(message,rate,part,transpose);
      this.stop('replaced');
      const startFrame=frame+256;
      Object.assign(this,{token,part,transpose,backing,level,startFrame});
      if(backing)Object.assign(labBackingClock,{playing:true,planId:token,startFrame,duration:plan.duration,
        click:{enabled:level>0,level:level/100,bpm:plan.bpm,meter:[4,4]}});
      this.clock.start(plan,startFrame);
    }catch{
      this.stop('invalid-demo',token);
      if(labBackingClock.planId===token)labBackingClock.playing=false;
      reject('invalid-demo');
    }
  }

  stop(reason,token=this.token) {
    if(token===this.token)this.clock.stop(reason);
  }

  mix(token,level) {
    if(!this.clock.active||!this.backing||token!==this.token||!Number.isInteger(level)||level<0||level>100)return;
    this.level=level;
    labBackingClock.click.enabled=level>0;
    labBackingClock.click.level=level/100;
    if(!level)this.clock.release();
  }

  tick(frame) {
    if(!this.clock.active)return;
    const x=this.engine();
    if(!x||x.sim_midi_mode?.()||this.conflict()||
      this.part!==undefined&&(!this.eligible(x,this.part)||x.sim_seq_transpose()!==this.transpose)){
      this.stop('interrupted');
      return;
    }
    const clock=this.clock;
    const elapsed=frame-clock.startFrame;
    const cycle=clock.loop?Math.max(0,Math.floor((elapsed+.499999)/clock.duration)):0;
    const startIndex=cycle>clock.cycle?0:clock.index;
    const relative=elapsed-Math.round(cycle*clock.duration);
    let attacks=0;
    for(let i=startIndex;i<clock.events.length&&clock.events[i].frame<=relative;i++){
      if(clock.events[i].velocity)attacks++;
    }
    if(attacks&&(!this.backing||this.level>0)){
      const limit=x.waswan_voice_limit(),needed=attacks*(x.waswan_mode(this.part)===1?2:1);
      let available=0;
      for(let i=0;i<limit&&available<needed;i++)if(!x.waswan_voice(i,0))available++;
      if(available<needed){this.stop('no-voices');return;}
    }
    clock.tick(frame);
  }
}
