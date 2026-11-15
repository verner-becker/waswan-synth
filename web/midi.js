// SPDX-License-Identifier: GPL-3.0-only
// Extensão de entrada; classe original preservada em midi-original.js no build.
import {MidiInputController as OriginalMidiInputController} from './midi-original.js';
import {MidiProfile} from './midi-profile.js';
import {mountProfilePanel} from './midi-profile-panel.js';

export class MidiInputController extends OriginalMidiInputController {
  constructor(options) {
    super(options);
    let storage;
    try { storage = globalThis.localStorage; } catch {}
    this.profile = new MidiProfile(storage);
    if (globalThis.document) mountProfilePanel(this);
  }
  message(data) {
    if (!this.isRunning() || !this.isListening()) return;
    if (this.profile.handle(data,this.input?.name,message => {
      this.send(message);
      if (message.t === 'fader' && globalThis.document) {
        const input = document.querySelectorAll('#faders input')[message.f];
        if (input) input.value = String(message.v);
      }
    })) return;
    super.message(data);
  }
  release() {
    this.profile?.reset();
    super.release();
  }
}
