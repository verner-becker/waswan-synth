// SPDX-License-Identifier: GPL-3.0-only
import {Engine as OriginalEngine} from './engine-original.js';

export class Engine extends OriginalEngine {
  input(message) {
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
    frame.polyphony = {
      limit:x.waswan_voice_limit(),
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
