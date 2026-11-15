// SPDX-License-Identifier: GPL-3.0-only
import {Engine as OriginalEngine} from './engine-original.js';

export class Engine extends OriginalEngine {
  constructor(...args){super(...args);this.fineAbsolute=Array(4).fill(null);}
  absoluteKnob(m) {
    const x=this.ex;
    if(!Number.isInteger(m.e)||m.e<0||m.e>3||!Number.isInteger(m.value)||m.value<0||m.value>127||
       !Number.isInteger(m.context)||m.context<0||m.context>0xffffffff||!Number.isInteger(m.revision)||m.revision<0||m.revision>0xffffffff||!x.waswan_knob_bound)return;
    if(m.context!==(x.waswan_knob_context()>>>0))return;
    const p=x.waswan_knob_param(m.e);if(p<0){this.fineAbsolute[m.e]=null;return;}
    const current=x.waswan_knob_value(m.e),min=x.waswan_knob_bound(m.e,0),max=x.waswan_knob_bound(m.e,1);
    const position=min+Math.round(m.value*(max-min)/127);
    let owner=this.fineAbsolute[m.e];
    if(!owner||owner.context!==m.context||owner.revision!==m.revision||owner.param!==p||owner.expected!==current){
      owner=this.fineAbsolute[m.e]={context:m.context,revision:m.revision,param:p,expected:current,previous:null,picked:false};
    }
    if(!owner.picked&&(position===current||(owner.previous!==null&&Math.min(owner.previous,position)<=current&&Math.max(owner.previous,position)>=current)))owner.picked=true;
    owner.previous=position;
    if(!owner.picked)return;
    const delta=position-current;
    if(delta&&!x.waswan_knob_fine(m.e,delta,m.context)){this.fineAbsolute[m.e]=null;return;}
    owner.expected=x.waswan_knob_value(m.e);
  }
  input(message) {
    if(message.t==='enc-fine-absolute'){this.absoluteKnob(message);return;}
    if (message.t === 'enc-fine') {
      if (Number.isInteger(message.e) && message.e>=0 && message.e<4 && Number.isInteger(message.steps) && Math.abs(message.steps)<=127 &&
          Number.isInteger(message.context) && message.context>=0 && message.context<=0xffffffff) {
        this.ex.waswan_knob_fine?.(message.e,message.steps,message.context);
      }
      return;
    }
    if (message.t === 'voice-sustain') {
      if (typeof message.enabled === 'boolean') this.ex.waswan_set_sustain(message.enabled ? 1 : 0);
      return;
    }
    const part = message.part;
    if (message.t === 'voice-mode' || message.t === 'voice-unison') {
      if (!Number.isInteger(part) || part < 0 || part >= 4) return;
      if (message.t === 'voice-mode' && Number.isInteger(message.mode) && message.mode >= 0 && message.mode <= 3) {
        this.ex.waswan_set_mode(part,message.mode);
      } else if (message.t === 'voice-unison' && Number.isInteger(message.count) && message.count >= 1 && message.count <= 8) {
        this.ex.waswan_set_unison(part,message.count);
      }
      return;
    }
    super.input(message);
  }
  frame() {
    const frame = super.frame(), x = this.ex;
    if (x.waswan_knob_context) frame.knobControl={context:x.waswan_knob_context()>>>0,
      parameters:Array.from({length:4},(_,k)=>{const p=x.waswan_knob_param(k);if(p<0)return null;
        const value=x.waswan_knob_value?.(k)??null,min=x.waswan_knob_bound?.(k,0)??null,max=x.waswan_knob_bound?.(k,1)??null,o=this.fineAbsolute[k];
        return {id:p,value,min,max,revision:o?.revision??null,picked:!!(o?.picked&&o.context===(x.waswan_knob_context()>>>0)&&o.param===p&&o.expected===value),pickupCC:min===null?null:Math.round(127*(value-min)/Math.max(1,max-min))};})};
    frame.polyphony = {
      limit:x.waswan_voice_limit(),
      unisonLimit:x.waswan_unison_limit(),
      midiSustain:!!x.waswan_midi_sustain(),
      slots:Array.from({length:x.waswan_voice_limit()},(_,i)=>({
        active:!!x.waswan_voice(i,0),gate:!!x.waswan_voice(i,1),
        note:x.waswan_voice(i,2),part:x.waswan_voice(i,3),
        stage:x.waswan_voice(i,4),sequence:x.waswan_voice(i,5),sequenced:!!x.waswan_voice(i,6),
      })),
      parts:Array.from({length:4},(_,part)=>({mode:x.waswan_mode(part),
        unison:x.waswan_unison(part),arp:x.waswan_arp(part),sustain:!!x.waswan_sustain(part),
        held:x.waswan_held(part),limit:x.waswan_part_limit(part)})),
    };
    return frame;
  }
}
