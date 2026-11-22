// SPDX-License-Identifier: GPL-3.0-only
import {audioTransport} from './daw-playback.js';
import {timelineFrame} from './daw-transport.js';
import {labBackingClock,loopFrame} from './music-lab-backing.js';
class DawClick extends AudioWorkletProcessor {
  constructor(options){super();this.lab=options?.processorOptions?.musicLab===true;this.phase=0;this.left=0;this.alive=true;this.port.onmessage=({data:m})=>{if(m.t==='dispose')this.alive=false;};}
  process(inputs,outputs){
    if(!this.alive)return false;
    const clock=this.lab?labBackingClock:audioTransport,c=clock.click,out=outputs[0];if(!clock.playing||!c){this.left=0;return true;}if(this.planId!==clock.planId){this.planId=clock.planId;this.left=0;}
    const unit=sampleRate*60/c.bpm*4/c.meter[1],first=clock.startFrame-(clock.countInFrames||0),duration=Math.round(sampleRate*.02);
    for(let i=0;i<out[0].length;i++){
      const frame=currentFrame+i,counting=frame<clock.startFrame;
      const position=counting?frame-first:this.lab?loopFrame(frame-clock.startFrame,clock.duration):timelineFrame(clock,frame);
      const enabled=position>=0&&(counting||c.enabled);
      if(enabled&&Math.floor(position/unit)!==Math.floor((position-1)/unit)){const beat=Math.round(position/unit),accent=((beat%c.meter[0])+c.meter[0])%c.meter[0]===0;this.increment=2*Math.PI*(accent?1500:1000)/sampleRate;this.phase=0;this.left=duration;}
      if(!enabled){this.left=0;continue;}if(this.left){const value=Math.sin(this.phase)*.16*c.level*(this.left/duration)**2;this.phase+=this.increment;this.left--;out[0][i]=out[1][i]=value;}
    }
    return true;
  }
}
registerProcessor('waswan-daw-click',DawClick);
