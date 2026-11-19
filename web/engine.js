// SPDX-License-Identifier: GPL-3.0-only
import {Engine as OriginalEngine} from './engine-original.js';
import {validateContext} from './studio-format.js';

import {FM_BYTES,stageTone,toneBytes} from './fm-patch.js';

const setupActions={
  setting:['waswan_instrument_set',2], bank:['waswan_pad_bank',1], pattern:['waswan_pattern_action',3],
  favourite:['waswan_favourite_action',3], keyboard:['waswan_keyboard_setup',10], row:['waswan_keyboard_activate',2],
  drum:['waswan_drum_set',4], mode:['waswan_controller_mode',1], controller:['waswan_controller_set',3],
  map:['waswan_controller_edit',6], controllerAction:['waswan_controller_action',1],
  sequence:['waswan_sequence_view',1], sequenceAdjust:['waswan_sequence_adjust',5],
  super:['waswan_super_set',3], kit:['waswan_kit_set',3], sequenceAction:['waswan_sequence_action',3]
};
const readString=(x,ptr)=>{
  const bytes=new Uint8Array(x.memory.buffer);
  let result='';
  for(let i=ptr;ptr&&i<ptr+64&&bytes[i];i++)result+=String.fromCharCode(bytes[i]);
  return result;
};

export class Engine extends OriginalEngine {
  constructor(...args){super(...args);this.fineAbsolute=Array(4).fill(null);this.controlOwners=Array(12).fill(null);}
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
  controlInput(m) {
    const x=this.ex,id=m.id;
    if(!x.waswan_ui_set||!Number.isInteger(id)||id<0||id>=12||!Number.isInteger(m.scope)||m.scope!==(x.waswan_ui_scope()>>>0))return;
    if(!x.waswan_ui_available(id))return;
    const current=x.waswan_ui_value(id),max=x.waswan_ui_max(id);
    if(m.source==='ui'){
      if(Number.isInteger(m.value)&&m.value>=0&&m.value<=max)x.waswan_ui_set(id,m.value,m.scope);
      return;
    }
    if(m.source!=='midi'||!Number.isInteger(m.revision)||m.revision<0||m.revision>0xffffffff)return;
    let value;
    if(m.mode==='absolute'){
      if(!Number.isInteger(m.value)||m.value<0||m.value>127)return;
      const position=Math.round(m.value*max/127);
      let o=this.controlOwners[id];
      if(!o||o.scope!==m.scope||o.revision!==m.revision||o.expected!==current)
        o=this.controlOwners[id]={scope:m.scope,revision:m.revision,expected:current,previous:null,picked:false};
      if(!o.picked&&(position===current||(o.previous!==null&&Math.min(o.previous,position)<=current&&Math.max(o.previous,position)>=current)))o.picked=true;
      o.previous=position;
      if(!o.picked)return;
      if(!x.waswan_ui_set(id,position,m.scope)){this.controlOwners[id]=null;return;}
      o.expected=x.waswan_ui_value(id);return;
    }
    if(!['offset','twos'].includes(m.mode)||!Number.isInteger(m.steps)||Math.abs(m.steps)>64)return;
    value=Math.max(0,Math.min(max,current+m.steps*(m.behavior==='fine'?1:2)));
    x.waswan_ui_set(id,value,m.scope);
  }
  toneBank(message,blocked) {
    const x=this.ex,{request,scope,token}=message;
    if(!Number.isSafeInteger(request)||request<1)return;
    try{
      if(blocked)throw Error(blocked);
      if(!x.waswan_tone_bank_load)throw Error('Tone banks require the 256-voice simulator');
      if(!x.waswan_program_available()||scope!==(x.waswan_ui_scope()>>>0)||token!==(x.waswan_program_token()>>>0))
        throw Error('The selected part or tone changed. Try again.');
      const part=x.sim_track();
      if(message.t==='tone-bank-read')this.toneBankResult={request,patch:toneBytes(x,part)};
      else{
        stageTone(x,false,part,message.patch);
        if(x.waswan_daw_staged_engine(part)<0)throw Error('This tone is invalid or unsupported');
        if(!x.waswan_tone_bank_load(scope,token,message.discard===true?1:0))
          throw Error('Stop playback and let the selected part fall silent before loading.');
        this.toneBankResult={request,loaded:true,token:x.waswan_program_token()>>>0};
      }
    }catch(error){this.toneBankResult={request,error:error.message};}
  }
  input(message) {
    if(message.t==='tone-bank-read'||message.t==='tone-bank-load'){this.toneBank(message);return;}
    if(message.t==='instrument-setup'){
      const spec=Object.hasOwn(setupActions,message.action)?setupActions[message.action]:null;
      const args=message.args;
      if(!spec||!Array.isArray(args)||args.length!==spec[1]||!args.every(value=>Number.isInteger(value)&&value>=-32768&&value<=32767))return;
      this.setupResult={request:message.request,applied:!!this.ex[spec[0]]?.(...args)};
      return;
    }
    if(message.t==='studio-mixer'){
      if(Number.isInteger(message.part)&&message.part>=0&&message.part<4&&Number.isInteger(message.field)&&message.field>=0&&message.field<8&&Number.isInteger(message.value))this.ex.waswan_studio_mix_set?.(message.part,message.field,message.value);
      return;
    }
    if(message.t==='fm-set'){
      const {field,value,scope}=message;
      if([field,value,scope].every(Number.isSafeInteger)&&field>=0&&field<FM_BYTES&&value>=0&&value<=127&&scope>=0&&scope<=0xffffffff)
        this.editorEdit={field,applied:!!this.ex.waswan_fm_edit?.(field,value,scope)};
      return;
    }
    if(message.t==='editor-set'){
      if(Number.isInteger(message.id)&&message.id>=0&&message.id<(this.ex.waswan_editor_count?.() ?? this.ex.waswan_parameter_count())&&
         Number.isInteger(message.value)&&Number.isInteger(message.scope)&&message.scope>=0&&message.scope<=0xffffffff)
        this.editorEdit={id:message.id,applied:!!this.ex.waswan_editor_set?.(message.id,message.value,message.scope)};
      return;
    }
    if(message.t==='editor-save'||message.t==='drum-preset-save'){
      const m=message,x=this.ex,u32=v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff;
      const save=m.t==='editor-save'?x.waswan_editor_save:x.waswan_drum_preset_save;
      if(!save||!Number.isSafeInteger(m.request)||m.request<1||!Number.isInteger(m.program)||m.program<1||m.program>99||
         !u32(m.scope)||!u32(m.token)||!u32(m.targetToken)||typeof m.name!=='string'||!/^[ A-Z0-9-]{1,10}$/.test(m.name)||!m.name.trim())return;
      // AudioWorkletGlobalScope does not guarantee TextEncoder; the validated name is ASCII.
      const name=m.name.padEnd(10,' '),buffer=new Uint8Array(x.memory.buffer,x.waswan_editor_name_buffer(),10);
      for(let i=0;i<10;i++)buffer[i]=name.charCodeAt(i);
      const applied=!!save(m.program-1,m.scope,m.token,m.targetToken);
      if(m.t==='drum-preset-save'){this.setupResult={request:m.request,applied};return;}
      this.editorSave={request:m.request,applied,program:m.program,part:m.scope&3,state:applied?'waiting':'rejected'};
      return;
    }
    if(message.t==='program-select'){
      if(Number.isSafeInteger(message.request)&&message.request>0&&Number.isInteger(message.program)&&message.program>=1&&
         message.program<=this.ex.waswan_program_count()&&Number.isInteger(message.scope)&&message.scope>=0&&message.scope<=0xffffffff&&
         Number.isInteger(message.token)&&message.token>=0&&message.token<=0xffffffff&&typeof message.discard==='boolean'){
        // Mode 2 also restores the stored slot when a bank file occupies its live part.
        const discard=message.discard?1+Number(message.reloadCurrent===true):0;
        this.programSelection={request:message.request,applied:!!this.ex.waswan_program_select(message.program-1,message.scope,message.token,discard)};
      }
      return;
    }
    if(message.t==='ui-control'){this.controlInput(message);return;}
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
    frame.toneBanks=!!x.waswan_tone_bank_load;
    if(this.toneBankResult){
      frame.toneBankResult=this.toneBankResult;
      this.toneBankResult=null;
    }
    if(x.waswan_editor_meta){
      const string=ptr=>{const bytes=new Uint8Array(x.memory.buffer);let s='';for(let i=ptr;i<ptr+64&&bytes[i];i++)s+=String.fromCharCode(bytes[i]);return s;};
      if(!this.editorCatalog){
        this.editorCatalog=Array.from({length:x.waswan_editor_count?.() ?? x.waswan_parameter_count()},(_,id)=>({id,name:string(x.waswan_editor_meta(id,0)),
          max:x.waswan_editor_meta(id,1),min:x.waswan_editor_meta(id,2),kind:x.waswan_editor_meta(id,3),shared:!!x.waswan_editor_meta(id,4)}));
        for(const p of this.editorCatalog)if([2,3,4,5,6,7,8,9,10,18].includes(p.kind))
          p.options=Array.from({length:p.max+1},(_,v)=>string(x.waswan_editor_format(p.id,v)));
        frame.editorCatalog=this.editorCatalog;
      }
      if(this.editorSave?.applied&&this.editorSave.state==='waiting'){
        if(frame.presetSave===3||(frame.presetSave===0&&!frame.manualPending)){this.editorSave.state='written';this.editorSave.hash=x.sim_store_hash()>>>0;}
        else if(frame.presetSave===4)this.editorSave.state='failed';
      }
      const values=this.editorCatalog.map(p=>x.waswan_editor_value(p.id));
      const cacheKey=`${frame.track}/${frame.engines[frame.track]}/${values.join(',')}`;
      if(cacheKey!==this.editorKey){this.editorKey=cacheKey;this.editorValues=values.map((value,id)=>({value,display:string(x.waswan_editor_format(id,value))}));}
      frame.editor={available:!!x.waswan_editor_available(),values:this.editorValues,edit:this.editorEdit,save:this.editorSave,
        targets:Array.from({length:99},(_,n)=>x.waswan_editor_slot_token(n)>>>0)};
    }
    if(x.waswan_fm_data){
      const fm=new Uint8Array(x.memory.buffer,x.waswan_fm_data(frame.track),FM_BYTES);
      frame.fm=fm[0]?{bytes:Array.from(fm),route:Array.from({length:6},(_,op)=>x.waswan_fm_route(fm[1],op))}:null;
    }
    if(x.waswan_program_count){
      const catalog=x.waswan_program_catalog();
      if(catalog!==this.programCatalog){
        this.programCatalog=catalog;
        frame.programLibrary=Array.from({length:x.waswan_program_count()},(_,n)=>({number:n+1,
          name:String.fromCharCode(...Array.from({length:10},(_,i)=>x.sim_program_name(n,i))).replace(/[^\x20-\x7e]/g,'').trim()}));
      }
      frame.programSelection=this.programSelection;
    }
    if (x.waswan_knob_context) frame.knobControl={context:x.waswan_knob_context()>>>0,
      parameters:Array.from({length:4},(_,k)=>{const p=x.waswan_knob_param(k);if(p<0)return null;
        const value=x.waswan_knob_value?.(k)??null,min=x.waswan_knob_bound?.(k,0)??null,max=x.waswan_knob_bound?.(k,1)??null,o=this.fineAbsolute[k];
        return {id:p,value,min,max,revision:o?.revision??null,picked:!!(o?.picked&&o.context===(x.waswan_knob_context()>>>0)&&o.param===p&&o.expected===value),pickupCC:min===null?null:Math.round(127*(value-min)/Math.max(1,max-min))};})};
    if(x.waswan_ui_scope)frame.instrument={
      scope:x.waswan_ui_scope()>>>0,
      programToken:x.waswan_program_token?.()>>>0,programAvailable:!!x.waswan_program_available?.(),
      name:String.fromCharCode(...Array.from({length:10},(_,i)=>x.waswan_ui_name(i))).replace(/[^\x20-\x7e]/g,'').trim(),
      edited:!!x.waswan_ui_edited(),bpm:x.sim_tempo(),playing:!!x.waswan_ui_playing(),
      controls:Array.from({length:12},(_,id)=>{const value=x.waswan_ui_value(id),o=this.controlOwners[id];return {
        value,min:0,max:x.waswan_ui_max(id),available:!!x.waswan_ui_available(id),
        physical:id===0?x.waswan_ui_cut_hz(value):id===3?x.waswan_ui_release_x10(value)/10:null,
        picked:!!(o?.picked&&o.scope===(x.waswan_ui_scope()>>>0)&&o.expected===value),revision:o?.revision??null,
      };}),
    };
    frame.polyphony = {
      limit:x.waswan_voice_limit(),
      unisonLimit:x.waswan_unison_limit(),
      midiSustain:!!x.waswan_midi_sustain(),
      slots:Array.from({length:x.waswan_voice_limit()},(_,i)=>{const owner=x.waswan_voice(i,6);return {
        active:!!x.waswan_voice(i,0),gate:!!x.waswan_voice(i,1),
        note:x.waswan_voice(i,2),part:x.waswan_voice(i,3),
        stage:x.waswan_voice(i,4),sequence:x.waswan_voice(i,5),sequenced:owner>0&&owner<4,monitorChannel:owner>=4&&owner<20?owner-4:null,
      };}),
      parts:Array.from({length:4},(_,part)=>({mode:x.waswan_mode(part),
        unison:x.waswan_unison(part),arp:x.waswan_arp(part),sustain:!!x.waswan_sustain(part),
        held:x.waswan_held(part),limit:x.waswan_part_limit(part)})),
    };
    if(x.waswan_instrument_setting){
      const read=(count,fn)=>Array.from({length:count},(_,i)=>fn(i));
      const sequence=x.waswan_native_sequence();
      frame.setup={
        result:this.setupResult,
        settings:read(16,x.waswan_instrument_setting),
        keyboard:read(2,row=>read(8,field=>x.waswan_keyboard_value(row,field))),
        drum:frame.engines[frame.track]===2?{
          kit:x.waswan_drum_value(0,3), overall:read(4,x.waswan_kit_value),
          sounds:read(8,lane=>read(3,field=>x.waswan_drum_value(lane,field)))
        }:null,
        super:read(2,setting=>x.waswan_super_value(frame.track,setting)),
        sequence:sequence?{
          view:x.waswan_sequence_state(0),page:x.waswan_sequence_state(1),length:x.waswan_sequence_state(2),
          record:x.waswan_sequence_state(3),endless:!!x.waswan_sequence_state(4),
          knobs:read(4,k=>({label:readString(x,x.waswan_sequence_label(k,0)),value:readString(x,x.waswan_sequence_label(k,1))}))
        }:null,
        controller:frame.midiMode?{
          settings:read(4,x.waswan_controller_value),
          entries:read(71,index=>read(5,field=>x.waswan_controller_entry(index,field))),
        }:null
      };
      if(frame.midiMode&&!this.setupControllerNames){
        this.setupControllerNames=read(71,index=>readString(x,x.waswan_controller_name(index)));
        frame.setup.controller.names=this.setupControllerNames;
      }
    }
    if(x.waswan_studio_mix_value)frame.studioMixer=Array.from({length:4},(_,part)=>Array.from({length:8},(_,field)=>x.waswan_studio_mix_value(part,field)));
    return frame;
  }
  restoreStudioContext(context,token){
    validateContext(context);const x=this.ex;
    if(!x.waswan_studio_context_buffer||!context.parts.every(p=>p.patch))throw Error('This project predates full tone snapshots');
    context.parts.forEach((p,i)=>stageTone(x,true,i,p.patch));
    if(!x.waswan_studio_apply_patches(token,...context.parts.map(p=>p.program-1)))throw Error('Instrument changed or is busy; saved context was not applied');
    if(context.mixer)for(let part=0;part<4;part++)for(let field=0;field<8;field++)x.waswan_studio_mix_set(part,field,context.mixer[part][field]);
    x.sim_master(context.master);x.waswan_studio_tempo(context.tempo);return true;
  }
}
