// SPDX-License-Identifier: GPL-3.0-only
import {demoSchedule} from './music-lab-model.js';
import {StudioClock} from './studio-clock.js';

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
    this.clock=new StudioClock((part,note,velocity)=>{
      return !!this.engine()?.waswan_studio_note(part,note,velocity);
    },state=>this.notify({t:'music-lab-state',token:this.token,part:this.part,...state}));
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
    const part=[x.sim_track(),...PARTS].find(part=>this.eligible(x,part));
    if(part===undefined)return reject('no-part');
    const transpose=x.sim_seq_transpose();
    try{
      const plan=demoSchedule(message,rate,part,transpose);
      this.stop('replaced');
      Object.assign(this,{token,part,transpose});
      this.clock.start(plan,frame+256);
    }catch{
      this.stop('invalid-demo',token);
      reject('invalid-demo');
    }
  }

  stop(reason,token=this.token) {
    if(token===this.token)this.clock.stop(reason);
  }

  tick(frame) {
    if(!this.clock.active)return;
    const x=this.engine();
    if(!x||x.sim_midi_mode?.()||this.conflict()||!this.eligible(x,this.part)||x.sim_seq_transpose()!==this.transpose){
      this.stop('interrupted');
      return;
    }
    const clock=this.clock;
    let attacks=0;
    for(let i=clock.index;i<clock.events.length&&clock.events[i].frame<=frame-clock.startFrame;i++){
      if(clock.events[i].velocity)attacks++;
    }
    if(attacks){
      const limit=x.waswan_voice_limit(),needed=attacks*(x.waswan_mode(this.part)===1?2:1);
      let available=0;
      for(let i=0;i<limit&&available<needed;i++)if(!x.waswan_voice(i,0))available++;
      if(available<needed){this.stop('no-voices');return;}
    }
    clock.tick(frame);
  }
}
