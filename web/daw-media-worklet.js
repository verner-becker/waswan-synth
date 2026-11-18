// SPDX-License-Identifier: GPL-3.0-only
import {audioTransport} from './daw-playback.js';
import {timelineFrame} from './daw-transport.js';
import {PcmRenderer,automationAt} from './daw-pcm.js';
import {RATE,PPQ} from './daw-project.js';
function validateLane(lane,min,max){
  if(lane===undefined)return;if(!lane||typeof lane.enabled!=='boolean'||!['linear','step'].includes(lane.curve)||!Array.isArray(lane.points)||lane.points.length>4096)throw Error('Invalid mixer automation');
  let previous=-1;for(const point of lane.points){if(!Number.isSafeInteger(point.tick)||point.tick<0||point.tick>8192*PPQ||point.tick<=previous||!Number.isFinite(point.value)||point.value<min||point.value>max)throw Error('Invalid mixer automation point');previous=point.tick;}
}
class DawMedia extends AudioWorkletProcessor {
  constructor(){super();this.renderer=new PcmRenderer();this.port.onmessage=({data:m})=>{
    try{
      let result;
      if(m.t==='asset')this.renderer.asset(m.id,m.left,m.right);
      else if(m.t==='prepare')this.renderer.prepare(m.planId,m.clips);
      else if(m.t==='retain')this.renderer.retain(m.ids);
      else if(m.t==='clear')this.renderer.clear();
      else if(m.t==='info'){let frames=0;for(const a of this.renderer.assets.values())frames+=a.left.length;result={sources:this.renderer.assets.size,frames,pcmBytes:frames*8,clips:this.renderer.clips.length};}
      else throw Error('Unknown audio plan command');
      this.port.postMessage({request:m.request,ok:true,result});
    }catch(error){this.port.postMessage({request:m.request,ok:false,error:error.message});}
  };}
  process(inputs,outputs){this.renderer.render(outputs,audioTransport,currentFrame);return true;}
}
class DawTrack extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [{name:'volume',defaultValue:1,minValue:0,maxValue:2},{name:'pan',defaultValue:0,minValue:-1,maxValue:1},{name:'mute',defaultValue:1,minValue:0,maxValue:1}];}
  constructor(){super();this.alive=true;this.port.onmessage=({data:m})=>{
    try{if(m.t==='prepare'){if(typeof m.planId!=='string'||!/^[\w-]{1,80}$/.test(m.planId)||!Number.isFinite(m.bpm)||m.bpm<40||m.bpm>240)throw Error('Invalid mixer plan');validateLane(m.volume,0,2);validateLane(m.pan,-1,1);this.planId=m.planId;this.bpm=m.bpm;this.volume=m.volume;this.pan=m.pan;}else if(m.t==='dispose'){this.alive=false;this.volume=this.pan=null;}else throw Error('Unknown mixer command');this.port.postMessage({request:m.request,ok:true});}
    catch(error){this.port.postMessage({request:m.request,ok:false,error:error.message});}
  };}
  process(inputs,outputs,parameters){
    if(!this.alive)return false;
    const out=outputs[0],input=inputs[0],active=audioTransport.playing&&this.planId===audioTransport.planId;
    if(audioTransport.playing&&!active)return true;
    for(let i=0;i<out[0].length;i++){
      const at=active?timelineFrame(audioTransport,currentFrame+i):-1,tick=at*PPQ*this.bpm/(RATE*60);
      const baseVolume=parameters.volume.length===1?parameters.volume[0]:parameters.volume[i],basePan=parameters.pan.length===1?parameters.pan[0]:parameters.pan[i],mute=parameters.mute.length===1?parameters.mute[0]:parameters.mute[i];
      const volume=at<0?baseVolume:automationAt(this.volume,tick,baseVolume),pan=at<0?basePan:automationAt(this.pan,tick,basePan),l=input?.[0]?.[i]||0,r=input?.[1]?.[i]||0,gain=volume*mute;
      // Inline to avoid allocating a pair for every sample.
      if(pan<=0){const x=(pan+1)*Math.PI/2;out[0][i]=(l+r*Math.cos(x))*gain;out[1][i]=r*Math.sin(x)*gain;}
      else{const x=pan*Math.PI/2;out[0][i]=l*Math.cos(x)*gain;out[1][i]=(r+l*Math.sin(x))*gain;}
    }
    return true;
  }
}
registerProcessor('waswan-daw-media',DawMedia);registerProcessor('waswan-daw-track',DawTrack);
