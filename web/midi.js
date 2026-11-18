// SPDX-License-Identifier: GPL-3.0-only
// Extensão de entrada; classe original preservada em midi-original.js no build.
import {MidiInputController as OriginalMidiInputController} from './midi-original.js';
import {MidiDiagnostic,mountMidiDiagnostic} from './midi-diagnostic.js';
import {MidiProfile} from './midi-profile.js';
import {mountProfilePanel} from './midi-profile-panel.js';
import {mountDspMonitor} from './dsp-monitor.js';
import {mountPolyphonyPanel} from './polyphony-panel.js';
import {observeStudioInput} from './studio-events.js';
import {observeDawInput} from './daw-input-events.js';

export class MidiInputController extends OriginalMidiInputController {
  constructor(options) {
    super(options);
    let storage;
    try { storage = globalThis.localStorage; } catch {}
    this.profile = new MidiProfile(storage);
    this.diagnostic = new MidiDiagnostic();
    if (globalThis.document) {
      mountProfilePanel(this);
      mountMidiDiagnostic(this);
      mountPolyphonyPanel(this);
      mountDspMonitor(this);
    }
  }
  refresh() {
    const profiles=this.contextProfiles,ports=this.ports();
    const topology=JSON.stringify(ports.map(input=>input.id).sort());
    if(this.contextMidiTopology!==topology){
      this.contextMidiTopology=topology;
      this.contextMidiTried=new Set();
    }
    if(this.selectedId&&!ports.some(p=>p.id===this.selectedId))
      this.contextMidiWanted={id:this.selectedId,profileId:profiles?.active?.id};
    super.refresh();
    profiles?.selectDevice(this.input,ports);
    if(!profiles?.enabled||this.selectedId||this.contextMidiOff||this.contextMidiSelecting)return;
    const wanted=this.contextMidiWanted;
    const known=ports.filter(input=>{
      const profile=profiles.match(input,ports);
      return !this.contextMidiTried.has(input.id)&&(wanted
        ?input.id===wanted.id||!!wanted.profileId&&profile?.id===wanted.profileId
        :!!profile);
    });
    if(known.length===1)void this.select(known[0].id);
  }
  async select(id,status='off') {
    if(id||status==='off')this.contextMidiOff=!id;
    if(id)this.contextMidiTried?.add(id);
    const attempt=Symbol();
    this.contextMidiSelecting=attempt;
    try{await super.select(id,status);}
    finally{if(this.contextMidiSelecting===attempt)this.contextMidiSelecting=null;}
    this.contextProfiles?.selectDevice(this.input,this.ports());
  }
  message(data,timeStamp) {
    const running=this.isRunning(),listening=this.isListening();
    observeStudioInput(data,timeStamp,{running,listening});
    const binding=this.diagnostic.active?this.profile.bindings.find(b=>b.port===this.input?.name&&b.channel===(data?.[0]&15)&&b.cc===data?.[1]):null;
    const entry=this.diagnostic.active?this.diagnostic.input(data,{running,listening,profileEnabled:this.profile.enabled,
      learning:!!this.profile.learning,target:binding?.target??null,mode:binding?.mode??null,behavior:binding?.behavior??null,
      profilePrevious:binding?this.profile.previous.get(JSON.stringify([binding.port,binding.channel,binding.cc]))??null:null,profileContext:this.profile.context}):null;
    if (!running || !listening) {if(entry)entry.disposition=!running?'ignored-not-running':'ignored-not-listening';return;}
    const learning=!!this.profile.learning;
    const contextConsumed=!!this.contextProfiles?.handle(data);
    const consumed=contextConsumed||this.profile.handle(data,this.input?.name,message => {
      if(entry)entry.commands.push({...message});
      this.send(message);
      if (message.t === 'fader' && globalThis.document) {
        const input = document.querySelectorAll('#faders input')[message.f];
        if (input) input.value = String(message.v);
      }
    });
    if(entry)entry.disposition=consumed?(contextConsumed?'context-profile':learning?'learned-no-output':entry.commands.length?'mapped-command-sent':'mapped-no-command'):'original-path';
    const routed=!consumed&&!!this.dawRouter?.route(data,timeStamp);observeDawInput(data,timeStamp,{running,listening,consumed,routed,deviceId:this.input?.id,deviceName:this.input?.name});
    if(consumed||routed)return;
    super.message(data);
  }
  release() {
    this.diagnostic?.reset();
    this.profile?.reset();
    this.contextProfiles?.reset();
    if(this.dawRouter?.protect()){this.dawRouter.release();return;}
    super.release();
  }
}
