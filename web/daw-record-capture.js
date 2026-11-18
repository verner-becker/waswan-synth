// SPDX-License-Identifier: GPL-3.0-only
import {audioTransport} from './daw-playback.js';
export class DawCapture extends AudioWorkletProcessor {
  constructor(){super();this.pool=[];this.frames=0;this.seq=0;this.used=0;this.finished=false;this.port.onmessage=({data:m})=>{if(m.t==='init'){this.token=m.token;this.limit=m.limit;this.sink=m.port;this.sink.onmessage=({data:b})=>{if(b.t==='buffer')this.pool.push(b.buffer);};this.sink.start();}if(m.t==='stop')this.finish(m.reason||'user');};}
  flush(){if(!this.used)return;const buffer=this.buffer;this.sink.postMessage({t:'chunk',seq:this.seq++,frame:this.chunkFrame,frames:this.used,buffer},[buffer]);this.buffer=null;this.used=0;}
  finish(reason){if(this.finished)return;this.finished=true;this.flush();this.sink?.postMessage({t:'ended',frames:this.frames,reason});}
  process(inputs){
    if(this.finished)return false;if(!this.token||!this.sink)return true;const clock=audioTransport;
    if(clock.recordToken===this.token&&clock.recording&&currentFrame>=clock.startFrame){
      const input=inputs[0];if(!input?.[0]?.length){this.finish('input-disconnected');return false;}
      if(this.first===undefined){this.first=currentFrame;this.sink.postMessage({t:'started',frame:this.first});}if(currentFrame!==this.first+this.frames){this.finish('discontinuity');return false;}
      for(let i=0;i<input[0].length;i++){
        if(this.frames>=this.limit){this.finish('duration-limit');return false;}
        if(!this.buffer){this.buffer=this.pool.pop();if(!this.buffer){this.finish('buffer-overrun');return false;}this.values=new Float32Array(this.buffer);this.chunkFrame=currentFrame+i;}
        const left=input[0][i],right=(input[1]||input[0])[i];if(!Number.isFinite(left)||!Number.isFinite(right)){this.finish('invalid-input');return false;}this.values[this.used*2]=left;this.values[this.used*2+1]=right;this.used++;this.frames++;if(this.used===4096)this.flush();
      }
    }else if(this.first!==undefined)this.finish(clock.recordToken===this.token?'arrangement-end':'transport-changed');
    return !this.finished;
  }
}
registerProcessor('waswan-daw-capture',DawCapture);
