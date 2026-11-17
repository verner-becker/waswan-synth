// SPDX-License-Identifier: GPL-3.0-only
// Ephemeral visual feedback. The recorded take remains the source for committed notes.
import {RATE} from './studio-format.js';
import {PPQ,MAX_NOTES} from './studio-sequence.js';
export class LiveNotes {
  constructor(part){this.part=part;this.notes=[];this.held=new Map();this.count=0;}
  input(event){
    if(!event.listening)return;const [status,note,velocity]=event.data,kind=status&240,key=(status&15)*128+note;
    if(kind!==128&&kind!==144)return;
    const previous=this.held.get(key);
    if(previous){previous.end=Math.max(previous.frame+1,event.frame);this.held.delete(key);}
    if(kind===144&&velocity){
      this.count++;if(this.notes.length>=MAX_NOTES)return;
      const n={frame:event.frame,end:null,note,velocity,part:this.part};this.notes.push(n);this.held.set(key,n);
    }
  }
  view(startFrame,now,sequence){
    if(!Number.isFinite(startFrame))return [];
    const tick=frame=>Math.round((frame-startFrame)*sequence.bpm*PPQ/(RATE*60));
    return this.notes.flatMap(n=>{let start=tick(n.frame),duration=Math.max(1,tick(n.end??now)-start);if(start<0){duration+=start;start=0;if(duration<1)return [];}
      if(sequence.loop){start%=sequence.length;duration=Math.min(duration,sequence.length-start);}
      return [{note:n.note,velocity:n.velocity,part:n.part,start,duration}];});
  }
}
