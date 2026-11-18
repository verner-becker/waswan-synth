// SPDX-License-Identifier: GPL-3.0-only
import {RATE} from './daw-project.js';
import {compileProject,assignSlots,trackAudible} from './daw-playback.js';
class InstrumentRequests {
  constructor(node){this.node=node;this.pending=new Map();node.port.addEventListener('message',({data:m})=>{if(m.t!=='daw-reply')return;const p=this.pending.get(m.request);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.request);m.ok?p.resolve(m.result):p.reject(Error(m.error));});}
  request(type,data={}){
    const request=crypto.randomUUID();
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(request);reject(Error('The audio host did not respond'));},10000);this.pending.set(request,{resolve,reject,timer});this.node.port.postMessage({t:type,request,...data});});
  }
}
export class DawPlayer {
  constructor(bridge,onState=()=>{}){Object.assign(this,{bridge,onState});this.generation=0;this.playing=false;this.starting=false;this.decoded=new Map();this.sources=[];this.tracks=new Map();this.slots=new Map();this.boundPatches=new Map();}
  requests(){const {node}=this.bridge.getAudio();if(!node)throw Error('Start audio before using an instrument');if(this.rpc?.node!==node)this.rpc=new InstrumentRequests(node);return this.rpc;}
  async tone(program){return this.requests().request('daw-program',{program});}
  async currentTone(part=0){const state=await this.requests().request('daw-state-request');const patch=state.patches[part];return {patch,type:patch[74]===79&&patch[78]===2?'drumx':patch[0]===4?'super':'analog'};}
  invalidateBinding(){this.projectId=null;this.slots.clear();this.boundPatches.clear();this.generation++;this.stopSources();this.playing=false;}
  synchronize(controller,changes){
    const project=controller.snapshot();if(this.projectId!==project.id)return 0;const commands=[];
    for(const change of changes){const id=[...this.slots].find(([,part])=>part===change.part)?.[0],track=project.tracks.find(t=>t.id===id),bound=this.boundPatches.get(id);if(!track?.instrument||!bound)continue;
      const followsLive=track.instrument.patch.every((v,i)=>v===bound[i]),changed=change.patch.some((v,i)=>v!==bound[i]);this.boundPatches.set(id,[...change.patch]);
      if(followsLive&&changed){const patch=change.patch,type=patch[74]===79&&patch[78]===2?'drumx':patch[0]===4?'super':'analog';commands.push({type:'track.update',payload:{id,changes:{instrument:{type,patch:[...patch]}}}});}
    }
    if(commands.length)controller.command('batch',{commands},{mergeKey:'live-timbres:'+project.id});return commands.length;
  }
  async capture(controller){if(this.projectId!==controller.snapshot().id||!this.slots.size||this.bridge.getAudio().context?.state!=='running')return;if(this.node!==this.bridge.getAudio().node){this.invalidateBinding();return;}const state=await this.requests().request('daw-state-request');this.synchronize(controller,state.patches.map((patch,part)=>({part,patch})));}
  async graph(){
    const {context,node,gain}=this.bridge.getAudio();if(!context||!node||!gain)throw Error('Start audio before playing the DAW');
    if(this.context===context&&this.node===node&&this.bus)return;
    await context.audioWorklet.addModule(new URL('./daw-bus.js',import.meta.url));
    this.context=context;this.node=node;this.bus=new AudioWorkletNode(context,'waswan-daw-bus',{numberOfInputs:1,outputChannelCount:[2]});this.bus.connect(gain);
    // Ensure the host clock runs before the project bus, including audio-only projects.
    this.clockLink=context.createGain();this.clockLink.gain.value=0;node.connect(this.clockLink,0);this.clockLink.connect(this.bus);
  }
  configureTracks(project,slots){
    for(const track of this.tracks.values()){if(track.part!==undefined)this.node.disconnect(track.input,track.part+1,0);track.input.disconnect();track.pan.disconnect();track.mute.disconnect();}
    this.tracks.clear();
    for(const t of project.tracks){const input=this.context.createGain(),pan=this.context.createStereoPanner(),mute=this.context.createGain(),part=slots.get(t.id);input.connect(pan).connect(mute).connect(this.bus);if(part!==undefined)this.node.connect(input,part+1);this.tracks.set(t.id,{input,pan,mute,part});}
    this.updateMix(project);
  }
  updateMix(project,restore=false){
    if(!this.context||!this.bus)return;const now=this.context.currentTime;
    this.lastProject=project;
    for(const t of project.tracks){const nodes=this.tracks.get(t.id);if(!nodes)continue;const automated=target=>this.playing&&!restore&&project.automation.some(l=>l.enabled&&l.trackId===t.id&&l.target===target&&l.points.length);
      if(!automated('volume')){nodes.input.gain.cancelScheduledValues(now);nodes.input.gain.setTargetAtTime(t.volume,now,.01);}
      if(!automated('pan')){nodes.pan.pan.cancelScheduledValues(now);nodes.pan.pan.setTargetAtTime(t.pan,now,.01);}
      nodes.mute.gain.setTargetAtTime(trackAudible(project,t)?1:0,now,.01);
    }
    this.bus.parameters.get('gain').setTargetAtTime(project.master.volume,now,.01);
  }
  scheduleAutomation(project,startFrame){
    const start=startFrame/RATE;
    for(const lane of project.automation){if(!lane.enabled||!lane.points.length)continue;const nodes=this.tracks.get(lane.trackId),parameter=lane.target==='volume'?nodes.input.gain:nodes.pan.pan;
      parameter.cancelScheduledValues(start);parameter.setValueAtTime(lane.points[0].value,start);
      for(const point of lane.points){const at=start+point.tick*60/(project.bpm*960);if(lane.curve==='linear')parameter.linearRampToValueAtTime(point.value,at);else parameter.setValueAtTime(point.value,at);}
    }
  }
  async buffers(project,assets,token){
    const needed=new Set(project.clips.filter(c=>c.type==='audio').map(c=>c.assetId));
    for(const id of needed){
      const source=assets.get(id),cached=this.decoded.get(id);if(cached?.source===source)continue;
      const buffer=await this.context.decodeAudioData(await source.arrayBuffer()),meta=project.assets.find(a=>a.id===id);
      if(this.generation!==token)throw Error('Playback preparation cancelled');
      if(buffer.sampleRate!==RATE||buffer.length!==meta.frames||buffer.numberOfChannels!==2)throw Error('Audio source decoded with an unexpected layout');
      this.decoded.set(id,{source,buffer});
    }
    for(const id of this.decoded.keys())if(!needed.has(id))this.decoded.delete(id);
  }
  scheduleAudio(data,startFrame){
    const start=startFrame/RATE;
    for(const {clip,track,start:at,seconds} of data.audio){
      const source=this.context.createBufferSource(),gain=this.context.createGain(),chain=[source,gain],nodes=this.tracks.get(track.id),when=start+at,end=when+seconds;
      source.buffer=this.decoded.get(clip.assetId).buffer;gain.gain.value=clip.gain;source.connect(gain);let last=gain;
      if(clip.pan){
        const split=this.context.createChannelSplitter(2),left=this.context.createGain(),right=this.context.createGain(),merge=this.context.createChannelMerger(2);left.gain.value=clip.pan>0?1-clip.pan:1;right.gain.value=clip.pan<0?1+clip.pan:1;
        last.connect(split);split.connect(left,0);split.connect(right,1);left.connect(merge,0,0);right.connect(merge,0,1);chain.push(split,left,right,merge);last=merge;
      }
      if(clip.fadeIn){const fade=this.context.createGain();fade.gain.setValueAtTime(0,when);fade.gain.linearRampToValueAtTime(1,when+clip.fadeIn/RATE);last.connect(fade);chain.push(fade);last=fade;}
      if(clip.fadeOut){const fade=this.context.createGain();fade.gain.setValueAtTime(1,when);fade.gain.setValueAtTime(1,end-clip.fadeOut/RATE);fade.gain.linearRampToValueAtTime(0,end);last.connect(fade);chain.push(fade);last=fade;}
      last.connect(nodes.input);this.sources.push({source,chain});source.onended=()=>{for(const n of chain)n.disconnect();this.sources=this.sources.filter(item=>item.source!==source);};source.start(when,clip.offset/RATE,seconds);
    }
  }
  async start(controller){
    if(this.starting||this.playing)throw Error('DAW is already preparing or playing');
    if(this.bridge.isStudioBusy?.())throw Error('Stop Studio before starting DAW');
    const project=controller.snapshot(),revision=controller.revision,slots=assignSlots(project),data=compileProject(project,slots),token=++this.generation;this.starting=true;this.projectId=project.id;
    this.onState({playing:false,preparing:true,frame:0});
    try{
      if(project.master.fx.length||project.tracks.some(t=>t.fx.length))throw Error('Saved effect chains require the upcoming DAW effects phase; project data has been preserved');
      await this.graph();await this.context.resume();await this.buffers(project,controller.assets,token);
      if(this.generation!==token||controller.revision!==revision)throw Error('Project changed during playback preparation');
      const rpc=this.requests();await rpc.request('daw-stop',{hard:true});const state=await rpc.request('daw-state-request');
      this.synchronize(controller,state.patches.map((patch,part)=>({part,patch})));if(controller.revision!==revision)throw Error('Project or live instrument changed during preparation; press Play again');
      await rpc.request('daw-apply',{projectId:project.id,revision,token:state.token,slots:[...slots].map(([id,part])=>({part,...project.tracks.find(t=>t.id===id).instrument}))});
      this.slots=slots;this.boundPatches=new Map([...slots].map(([id])=>[id,[...project.tracks.find(t=>t.id===id).instrument.patch]]));
      if(this.generation!==token)throw Error('Playback preparation cancelled');
      this.configureTracks(project,slots);
      const startFrame=Math.ceil((this.context.currentTime*RATE+8192)/128)*128;
      const pending=rpc.request('daw-start',{projectId:project.id,revision,startFrame,data:{events:data.events,length:data.length,loop:false}});
      this.scheduleAudio(data,startFrame);this.scheduleAutomation(project,startFrame);await pending;
      if(this.generation!==token)throw Error('Playback preparation cancelled');
      this.playing=true;this.startFrame=startFrame;this.length=data.length;return {startFrame,length:data.length};
    }catch(error){await this.stop();throw error;}finally{this.starting=false;}
  }
  stopSources(){for(const {source,chain} of this.sources){try{source.stop();}catch{}for(const node of chain)node.disconnect();}this.sources=[];}
  async stop(hard=false){this.generation++;this.stopSources();this.playing=false;if(this.lastProject)this.updateMix(this.lastProject,true);const node=this.bridge.getAudio().node;if(node&&(this.rpc||this.bus))await this.requests().request('daw-stop',{hard});this.onState({playing:false,preparing:false,frame:0,reason:'user'});}
  receive(m){
    if(m.t!=='daw-state'||m.projectId!==this.projectId)return;
    this.playing=m.playing;if(!m.playing){this.stopSources();if(this.lastProject)this.updateMix(this.lastProject,true);}this.onState(m);
  }
  reset(){this.stopSources();this.decoded.clear();this.projectId=null;this.lastProject=null;this.slots.clear();this.boundPatches.clear();for(const track of this.tracks.values()){if(track.part!==undefined)this.node.disconnect(track.input,track.part+1,0);track.input.disconnect();track.pan.disconnect();track.mute.disconnect();}this.tracks.clear();}
}
