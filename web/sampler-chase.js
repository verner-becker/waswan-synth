// SPDX-License-Identifier: GPL-3.0-only
import {heldKey} from './daw-transport.js';
// Capture selection state as bounded schedule chunks arrive. A seek restarts
// held samples at their attack, with their original variation and articulation.
export class SamplerChase {
  constructor(runtime, schedule) {
    this.runtime = runtime;
    this.held = new Map();
    this.checkpoints = new Map();
    this.positions = [schedule.fromFrame ?? 0];
    if (schedule.loop && schedule.loopStart !== schedule.fromFrame) this.positions.push(schedule.loopStart ?? 0);
    this.positions.sort((a,b) => a-b);
    runtime.resetSequence();
  }
  checkpoint() {
    this.checkpoints.set(this.positions.shift(), {state:this.runtime.sequenceState(), held:new Map(this.held)});
  }
  append(events) {
    for (const event of events) {
      while (this.positions.length && (event.frame > this.positions[0] ||
          (event.frame === this.positions[0] && (event.type || event.velocity)))) this.checkpoint();
      if (!this.positions.length) break;
      if (event.type || !this.runtime.routes.has(event.part)) continue;
      const key = heldKey(event);
      if (event.velocity) this.held.set(key, this.runtime.sequenceState(event.part,event.channel??0));
      else this.held.delete(key);
      this.runtime.chase(event.part, event.note, event.velocity, event.channel, event.noteId);
    }
  }
  finish() {
    while (this.positions.length) this.checkpoint();
    this.runtime.resetSequence();
    this.held.clear();
  }
  enter(position) {
    this.current = this.checkpoints.get(position);
    this.runtime.resetSequence();
    this.runtime.restoreSequenceState(this.current.state);
  }
  beforeHeld(note) {
    const prior = this.current.held.get(heldKey(note));
    if (prior) this.runtime.restoreSequenceState(prior);
  }
  afterHeld() { this.runtime.restoreSequenceState(this.current.state); }
}
