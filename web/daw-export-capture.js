// SPDX-License-Identifier: GPL-3.0-only
import {audioTransport} from './daw-playback.js';

const chunkFrames=1024;
class DawExportCapture extends AudioWorkletProcessor {
  constructor(){
    super();
    this.pool=[];
    this.frames=0;
    this.used=0;
    this.sequence=0;
    this.port.onmessage=({data:m})=>{
      if(m.t==='init'){
        this.sink=m.port;
        this.count=m.count;
        this.sink.onmessage=({data:buffer})=>this.pool.push(new Float32Array(buffer));
      }else if(m.t==='arm'){
        this.job=m;
        this.port.postMessage({t:'armed'});
      }
    };
  }
  flush(){
    const buffer=this.samples.buffer;
    this.sink.postMessage({t:'chunk',seq:this.sequence++,frames:this.used,buffer},[buffer]);
    this.samples=null;
    this.used=0;
  }
  finish(error){
    if(!error&&this.used)this.flush();
    this.sink.postMessage({t:'end',frames:this.frames,error});
    return false;
  }
  process(inputs){
    const job=this.job;
    if(!job||currentFrame+128<=job.first)return true;
    if(audioTransport.exportToken!==job.token||audioTransport.exportPlan!==job.planId)
      return this.finish('Export transport changed');
    const from=Math.max(0,job.first-currentFrame),n=inputs[0]?.[0]?.length;
    if(!n||currentFrame+from!==job.first+this.frames)return this.finish('Discontinuous export audio');
    for(let i=from;i<n&&this.frames<job.frames;i++){
      if(!this.samples){
        this.samples=this.pool.pop();
        if(!this.samples)return this.finish('Export writer fell behind');
      }
      let at=this.used*this.count*2;
      for(let j=0;j<this.count;j++){
        const left=inputs[j]?.[0]?.[i]??0,right=inputs[j]?.[1]?.[i]??0;
        if(!Number.isFinite(left)||!Number.isFinite(right))return this.finish('Non-finite export audio');
        this.samples[at++]=left;
        this.samples[at++]=right;
      }
      this.frames++;
      if(++this.used===chunkFrames)this.flush();
    }
    return this.frames===job.frames?this.finish():true;
  }
}
registerProcessor('waswan-daw-export-capture',DawExportCapture);
