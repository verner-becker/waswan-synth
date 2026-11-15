// SPDX-License-Identifier: GPL-3.0-only
// Extensão de entrada; classe original preservada em midi-original.js no build.
import {MidiInputController as OriginalMidiInputController} from './midi-original.js';
import {MidiDiagnostic,mountMidiDiagnostic} from './midi-diagnostic.js';
import {MidiProfile} from './midi-profile.js';
import {mountProfilePanel} from './midi-profile-panel.js';
import {mountDspMonitor} from './dsp-monitor.js';
import {mountPolyphonyPanel} from './polyphony-panel.js';

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
  message(data) {
    const running=this.isRunning(),listening=this.isListening();
    const binding=this.diagnostic.active?this.profile.bindings.find(b=>b.port===this.input?.name&&b.channel===(data?.[0]&15)&&b.cc===data?.[1]):null;
    const entry=this.diagnostic.active?this.diagnostic.input(data,{running,listening,profileEnabled:this.profile.enabled,
      learning:!!this.profile.learning,target:binding?.target??null,mode:binding?.mode??null,behavior:binding?.behavior??null,
      profilePrevious:binding?this.profile.previous.get(JSON.stringify([binding.port,binding.channel,binding.cc]))??null:null,profileContext:this.profile.context}):null;
    if (!running || !listening) {if(entry)entry.disposition=!running?'ignored-not-running':'ignored-not-listening';return;}
    const learning=!!this.profile.learning;
    const consumed=this.profile.handle(data,this.input?.name,message => {
      if(entry)entry.commands.push({...message});
      this.send(message);
      if (message.t === 'fader' && globalThis.document) {
        const input = document.querySelectorAll('#faders input')[message.f];
        if (input) input.value = String(message.v);
      }
    });
    if(entry)entry.disposition=consumed?(learning?'learned-no-output':entry.commands.length?'mapped-command-sent':'mapped-no-command'):'original-path';
    if(consumed)return;
    super.message(data);
  }
  release() {
    this.diagnostic?.reset();
    this.profile?.reset();
    super.release();
  }
}
