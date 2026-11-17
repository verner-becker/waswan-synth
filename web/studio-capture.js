// SPDX-License-Identifier: GPL-3.0-only
// Transparent tap; the synth and its output graph remain independent of recording.
import {MAX_FRAMES} from './studio-format.js';
class StudioCapture extends AudioWorkletProcessor {
  constructor(){
    super();this.pool=[];this.active=false;this.used=0;this.frames=0;this.seq=0;
    this.port.onmessage=({data:m})=>{
      if(m.t==='buffer')this.pool.push(m.buffer);
      if(m.t==='start'&&!this.active){this.active=true;this.first=currentFrame;this.port.postMessage({t:'started',frame:currentFrame});}
      if(m.t==='stop')this.stop(m.reason||'user');
      if(m.t==='stop-at'&&Number.isSafeInteger(m.frame)&&m.frame>=0){this.endFrame=m.frame;this.endReason=m.reason;}
    };
  }
  flush(){
    if(!this.used)return;
    this.port.postMessage({t:'chunk',buffer:this.buffer,frames:this.used,frame:this.chunkFrame,seq:this.seq++},[this.buffer]);this.buffer=null;this.used=0;
  }
  stop(reason){
    if(!this.active)return;this.active=false;this.flush();
    this.port.postMessage({t:'ended',first:this.first,frames:this.frames,reason});
  }
  process(inputs,outputs){
    if(!this.active)return true;
    const n=Math.max(0,Math.min(outputs[0][0].length,MAX_FRAMES-this.frames,this.endFrame===undefined?Infinity:this.endFrame-currentFrame));
    if(!n){this.stop(this.endFrame!==undefined?'arrangement-end':'duration-limit');return true;}
    if(!this.buffer){
      this.buffer=this.pool.pop();if(!this.buffer){this.stop('buffer-overrun');return true;}
      this.data=new Float32Array(this.buffer);this.chunkFrame=currentFrame;
    }
    const input=inputs[0];
    if(!input?.[0]){this.stop('missing-input');return true;}
    for(let i=0;i<n;i++){this.data[(this.used+i)*2]=input[0][i];this.data[(this.used+i)*2+1]=input[1]?.[i]??input[0][i];}
    this.used+=n;this.frames+=n;if(this.used>=4096)this.flush();
    if(this.frames>=MAX_FRAMES)this.stop('duration-limit');
    else if(this.endFrame!==undefined&&currentFrame+n>=this.endFrame)this.stop(this.endReason||'arrangement-end');
    return true;
  }
}
registerProcessor('waswan-studio-capture',StudioCapture);
