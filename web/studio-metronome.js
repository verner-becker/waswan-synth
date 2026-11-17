// SPDX-License-Identifier: GPL-3.0-only
class StudioMetronome extends AudioWorkletProcessor {
  constructor(){super();this.port.onmessage=({data:m})=>{this.settings=m.t==='start'?m:null;};}
  process(_inputs,outputs){
    const s=this.settings;if(!s)return true;
    const beatFrames=sampleRate*60/s.bpm*4/s.meter[1],out=outputs[0];
    for(let i=0;i<out[0].length;i++){
      const frame=currentFrame+i-s.startFrame;if(frame<0)continue;
      const beat=Math.floor(frame/beatFrames),age=(frame-Math.round(beat*beatFrames))/sampleRate;
      const value=age>=0&&age<.025?Math.sin(age*Math.PI*2*(beat%s.meter[0]===0?1800:1200))*(1-age/.025)*.12:0;
      for(const channel of out)channel[i]=value;
    }
    return true;
  }
}
registerProcessor('waswan-studio-metronome',StudioMetronome);
