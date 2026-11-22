// SPDX-License-Identifier: GPL-3.0-only
import {action,el} from './ui-primitives.js';
import {subscribeDawInput} from './daw-input-events.js';
import {labMidiEvent} from './music-lab-assessment.js';
import {midiPitchLabel} from './music-lab-model.js';

export class MusicLabRange {
  constructor({bridge,conflict,channel,onChange}) {
    Object.assign(this,{bridge,conflict,channel,onChange,blocked:false});
    this.node=el('div','ww-lab-range');
    this.start=action('Calibrar alcance',()=>this.begin());
    this.confirm=action('Confirmar alcance',()=>this.save());
    this.cancelButton=action('Cancelar calibração',()=>this.cancel());
    this.status=el('span','ww-muted');
    this.status.setAttribute('role','status');
    this.node.append(this.start,this.confirm,this.cancelButton,this.status);
    this.paint();
  }

  get active() {return !!this.lease;}

  sameDevice({input,generation}) {
    return this.bridge.midi.input===input&&input.state!=='disconnected'&&this.bridge.midi.generation===generation;
  }

  get current() {
    const result=this.result,channel=this.channel();
    return result&&this.sameDevice(result)&&(channel===null||channel===result.channel)?result:null;
  }

  canStart() {
    return !this.blocked&&this.bridge.midi.input&&this.bridge.midi.input.state!=='disconnected'&&
      this.bridge.isRunning()&&this.bridge.getAudio().context?.state==='running'&&!this.conflict();
  }

  begin() {
    if(this.lease||!this.canStart())return;
    const {input,generation}=this.bridge.midi;
    const lease={input,generation,channel:this.channel(),min:null,max:null};
    this.lease=lease;
    this.result=null;
    this.message='';
    lease.unsubscribe=subscribeDawInput(raw=>{
      if(raw.deviceId!==input.id||!raw.running||!raw.listening||raw.routed||raw.consumed)return;
      const event=labMidiEvent(raw);
      if(event?.type==='on')queueMicrotask(()=>this.accept(lease,event));
    });
    this.paint();
    this.onChange();
    this.cancelButton.focus({preventScroll:true});
  }

  accept(lease,{pitch,channel}) {
    if(this.lease!==lease||lease.max!==null||!this.sameDevice(lease)||!this.canStart())return;
    if(lease.channel!==null&&lease.channel!==channel)return;
    lease.channel=channel;
    if(lease.min===null)lease.min=pitch;
    else if(pitch>lease.min){
      lease.max=pitch;
      lease.unsubscribe();
      lease.unsubscribe=null;
    }else{
      this.message='Toque uma nota acima de '+midiPitchLabel(lease.min)+'.';
      this.paint();
      return;
    }
    this.message='';
    this.paint();
    if(lease.max!==null&&document.activeElement===this.cancelButton)this.confirm.focus({preventScroll:true});
  }

  save() {
    const lease=this.lease;
    if(!lease||lease.max===null)return;
    if(!this.sameDevice(lease)||!this.canStart()){this.cancel('A calibração foi interrompida.');return;}
    const {input,generation,channel,min,max}=lease;
    this.result={input,generation,channel,min,max};
    this.cancel();
    this.start.focus({preventScroll:true});
  }

  cancel(message='') {
    if(!this.lease)return;
    this.lease.unsubscribe?.();
    this.lease=null;
    this.message=message;
    this.paint();
    this.onChange();
  }

  refresh(blocked) {
    this.blocked=blocked;
    if(this.lease&&(!this.sameDevice(this.lease)||!this.canStart()))this.cancel('A calibração foi interrompida.');
    if(this.result&&!this.sameDevice(this.result)){
      this.result=null;
      this.message='';
    }
    this.paint();
  }

  paint() {
    const lease=this.lease,result=this.current;
    this.start.hidden=!!lease;
    const disabled=!this.canStart();
    if(this.start.disabled!==disabled)this.start.disabled=disabled;
    this.confirm.hidden=!lease||lease.max===null;
    this.cancelButton.hidden=!lease;
    const label=this.message||(!lease?(result?`Faixa medida ${midiPitchLabel(result.min)}–${midiPitchLabel(result.max)} · canal ${result.channel+1}. Recalibre após mudar a oitava do controlador.`:''):
      lease.max!==null?`Confirme as extremidades ${midiPitchLabel(lease.min)}–${midiPitchLabel(lease.max)} na oitava que deseja usar.`:
      lease.min===null?'Toque a tecla mais grave na oitava que deseja usar.':'Agora toque a tecla mais aguda.');
    if(this.status.textContent!==label)this.status.textContent=label;
  }
}
