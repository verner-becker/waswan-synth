// SPDX-License-Identifier: GPL-3.0-only
import {FxChain} from './daw-effects.js';
import {validateEffects} from './daw-fx-catalog.js';
import {RATE} from './daw-project.js';
import {compileProject,assignSlots,trackAudible} from './daw-playback.js';
import {prepareSchedule} from './daw-transport.js';
import {prepareProjectSamplers} from './sampler.js';

// Two sampler revisions can use identical backing patch bytes.
export function instrumentBinding(instrument){
  if(instrument?.type==='sampler')return [...instrument.patch,instrument.libraryId,instrument.instrumentId,instrument.revision];
  return instrument?.patch;
}
class InstrumentRequests {
  constructor(node,reply='daw-reply'){
    this.node=node;this.pending=new Map();
    this.listen=({data:m})=>{
      if(reply&&m.t!==reply)return;
      const p=this.pending.get(m.request);if(!p)return;
      clearTimeout(p.timer);this.pending.delete(m.request);
      m.ok?p.resolve(m.result):p.reject(Error(m.error));
    };
    node.port.addEventListener('message',this.listen);node.port.start();
  }
  request(type,data={},transfer=[]){
    if(this.closed)return Promise.reject(Error('The audio graph changed'));
    const request=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(request);reject(Error('The audio host did not respond'));},10000);
      this.pending.set(request,{resolve,reject,timer});
      try{this.node.port.postMessage({t:type,request,...data},transfer);}
      catch(error){clearTimeout(timer);this.pending.delete(request);reject(error);}
    });
  }
  close(){
    this.closed=true;this.node.port.removeEventListener('message',this.listen);
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('The audio graph changed'));}
    this.pending.clear();
  }
}
export class DawPlayer {
  constructor(bridge,onState=()=>{}){Object.assign(this,{bridge,onState});this.generation=0;this.exporting=null;this.playing=false;this.starting=false;this.decoded=new Map();this.sources=[];this.tracks=new Map();this.slots=new Map();this.boundPatches=new Map();}
  requests(){const {node}=this.bridge.getAudio();if(!node)throw Error('Start audio before using an instrument');if(this.rpc?.node!==node){this.rpc?.close();this.rpc=new InstrumentRequests(node);}return this.rpc;}
  setClick(settings){
    this.clickSettings=settings;
    if(this.playing&&!this.exporting)return this.requests().request('daw-click',settings);
  }
  async tone(program){return this.requests().request('daw-program',{program});}
  async drumKits(){return this.requests().request('daw-drum-catalog');}
  async drumKit(kit){return this.requests().request('daw-drum-kit',{kit});}
  async tapeInstrument(tape){
    const {patch}=await this.requests().request('daw-tape-patch');
    return {type:'mellotron',patch,tape};
  }
  async currentTone(part=0){
    const tape=this.bridge.liveTape?.(part);
    if(tape)return this.tapeInstrument(tape);
    const state=await this.requests().request('daw-state-request');
    if(part===0&&state.liveSampler){
      if(!state.liveSampler.path)throw Error('Publish the preview sample as an instrument before assigning it to a track');
      return state.liveSampler;
    }
    const patch=state.patches[part];return {patch,type:patch[74]===79&&patch[78]===2?'drumx':patch[0]===4?'super':'analog'};}
  invalidateBinding(){this.discardStaleGraph();this.clearEffects();this.projectId=null;this.planId=null;this.slots.clear();this.boundPatches.clear();this.generation++;this.stopSources();this.playing=false;}
  synchronize(controller,changes){
    const project=controller.snapshot();if(this.projectId!==project.id)return 0;const commands=[];
    for(const change of changes){const id=[...this.slots].find(([,part])=>part===change.part)?.[0],track=project.tracks.find(t=>t.id===id),bound=this.boundPatches.get(id);if(!track?.instrument||['mellotron','sampler'].includes(track.instrument.type)||!bound)continue;
      const followsLive=track.instrument.patch.length===bound.length&&track.instrument.patch.every((v,i)=>v===bound[i]),changed=change.patch.length!==bound.length||change.patch.some((v,i)=>v!==bound[i]);this.boundPatches.set(id,[...change.patch]);
      if(followsLive&&changed){const patch=change.patch,type=patch[74]===79&&patch[78]===2?'drumx':patch[0]===4?'super':'analog';commands.push({type:'track.update',payload:{id,changes:{instrument:{type,patch:[...patch]}}}});}
    }
    if(commands.length)controller.command('batch',{commands},{mergeKey:'live-timbres:'+project.id});return commands.length;
  }
  async capture(controller){if(this.projectId!==controller.snapshot().id||!this.slots.size||this.bridge.getAudio().context?.state!=='running')return;if(this.node!==this.bridge.getAudio().node){this.invalidateBinding();return;}const state=await this.requests().request('daw-state-request');this.synchronize(controller,state.patches.map((patch,part)=>({part,patch})));}
  discardStaleGraph(){
    if(!this.context)return;
    const current=this.bridge.getAudio();
    if(current.context===this.context&&current.node===this.node&&current.gain===this.gain)return;
    this.stopSources();
    if(this.exporting?.opened){
      const job=this.exporting;
      this.node.port.postMessage({t:'daw-export-close',request:crypto.randomUUID(),exportToken:job.token});
      job.fail(Error('The audio graph changed during export'));
      this.exporting=null;
    }
    if(this.rpc?.node===this.node){this.rpc.close();this.rpc=null;}
    for(const track of this.tracks.values())this.disposeTrack(track);
    this.tracks.clear();this.decoded.clear();this.masterFx?.dispose();this.mediaRpc?.close();
    try{this.node.disconnect(this.clockLink,0,0);}catch{}
    for(const node of [this.bus,this.media,this.masterMeter,this.click])if(node){
      node.port.postMessage({t:'dispose'});
      node.disconnect();node.port.close();
    }
    this.clockLink?.disconnect();this.speaker?.disconnect();
    this.context=this.node=this.gain=this.bus=this.media=this.mediaRpc=this.clockLink=this.speaker=this.click=this.masterFx=this.masterMeter=null;
    this.masterLevels=this.lastProject=this.projectId=this.planId=this.liveSessionToken=null;
    this.slots.clear();this.boundPatches.clear();this.playing=false;
  }
  async graph(){
    this.discardStaleGraph();
    const {context,node,gain}=this.bridge.getAudio();if(!context||!node||!gain)throw Error('Start audio before playing the DAW');
    if(this.context===context&&this.node===node&&this.bus)return;
    await context.audioWorklet.addModule(new URL('./daw-bus.js',import.meta.url));
    await context.audioWorklet.addModule(new URL('./daw-media-worklet.js',import.meta.url));
    await context.audioWorklet.addModule(new URL('./daw-click.js',import.meta.url));
    await context.audioWorklet.addModule(new URL('./daw-fx-worklet.js',import.meta.url));
    const current=this.bridge.getAudio();
    if(current.context!==context||current.node!==node||current.gain!==gain)throw Error('The audio output changed while preparing the DAW');
    if(this.context===context&&this.node===node&&this.bus)return;
    this.context=context;this.node=node;this.gain=gain;this.bus=new AudioWorkletNode(context,'waswan-daw-bus',{numberOfInputs:1,outputChannelCount:[2]});this.masterFx=new FxChain(context);this.masterMeter=new AudioWorkletNode(context,'waswan-daw-master-meter',{outputChannelCount:[2]});this.masterMeter.port.onmessage=({data:m})=>{if(!this.exporting)this.masterLevels=m;};this.speaker=context.createGain();this.bus.connect(this.masterFx.input);this.masterFx.output.connect(this.masterMeter).connect(this.speaker).connect(gain);
    // Ensure the host clock runs before the project bus, including audio-only projects.
    this.clockLink=context.createGain();this.clockLink.gain.value=0;node.connect(this.clockLink,0);this.clockLink.connect(this.bus);
    this.click=new AudioWorkletNode(context,'waswan-daw-click',{numberOfInputs:1,outputChannelCount:[2]});this.clockLink.connect(this.click);this.click.connect(gain);
    this.media=new AudioWorkletNode(context,'waswan-daw-media',{numberOfInputs:1,numberOfOutputs:32,outputChannelCount:Array(32).fill(2)});this.mediaRpc=new InstrumentRequests(this.media,null);this.clockLink.connect(this.media);
  }
  async disconnectTracks(){
    for(const track of this.tracks.values())await this.disconnectTrack(track);
    this.tracks.clear();
  }
  async disconnectTrack(track){
    try{await track.rpc.request('dispose');await track.gateRpc.request('dispose');}
    finally{this.disposeTrack(track);}
  }
  disposeTrack(track){
    if(track.part!==undefined){
      try{this.node.disconnect(track.input,track.part+1,0);}catch{}
      try{this.node.disconnect(track.gate,track.part+9,1);}catch{}
    }
    if(track.output!==null)try{this.media.disconnect(track.input,track.output,0);}catch{}
    for(const [node,rpc] of [[track.gate,track.gateRpc],[track.mix,track.rpc]]){
      node.port.postMessage({t:'dispose'});rpc.close();node.disconnect();node.port.close();
    }
    track.input.disconnect();track.effects.dispose();track.meter.disconnect();
  }
  async configureTracks(project,slots,planId){
    for(const [id,track] of this.tracks)if(!project.tracks.some(t=>t.id===id)){await this.disconnectTrack(track);this.tracks.delete(id);}
    for(const [output,t] of project.tracks.entries()){
      let track=this.tracks.get(t.id);const part=slots.get(t.id);
      if(!track){const input=this.context.createGain(),gate=new AudioWorkletNode(this.context,'waswan-daw-source-gate',{numberOfInputs:2,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'}),mix=new AudioWorkletNode(this.context,'waswan-daw-track',{numberOfInputs:1,outputChannelCount:[2]}),meter=this.context.createAnalyser();meter.fftSize=256;const effects=new FxChain(this.context);input.connect(gate,0,0);gate.connect(effects.input);effects.output.connect(mix).connect(meter).connect(this.bus);track={input,gate,mix,meter,effects,rpc:new InstrumentRequests(mix,null),gateRpc:new InstrumentRequests(gate,null),output:null,part:undefined};this.tracks.set(t.id,track);}
      if(track.output!==output){if(track.output!==null)this.media.disconnect(track.input,track.output,0);this.media.connect(track.input,output);track.output=output;}
      if(track.part!==part){if(track.part!==undefined){this.node.disconnect(track.input,track.part+1,0);this.node.disconnect(track.gate,track.part+9,1);}if(part!==undefined){this.node.connect(track.input,part+1);this.node.connect(track.gate,part+9,1);}track.part=part;}
      await track.gateRpc.request('prepare',{planId});await track.rpc.request('prepare',{planId,bpm:project.bpm,volume:project.automation.find(l=>l.enabled&&l.trackId===t.id&&l.target==='volume'),pan:project.automation.find(l=>l.enabled&&l.trackId===t.id&&l.target==='pan')});
      if(this.liveSessionToken)await track.gateRpc.request('live-session',{token:this.liveSessionToken});
    }
    this.updateMix(project);await this.masterFx.ready();for(const t of this.tracks.values())await t.effects.ready();
  }
  clearEffects(){this.masterFx?.update([]);for(const track of this.tracks.values())track.effects.update([]);}
  async beginExport(job){
    if(this.exporting||this.starting||this.playing||this.liveSessionToken||this.bridge.isStudioBusy?.())throw Error('Stop playback and turn off DAW inputs before exporting');
    this.exporting=job;
    try{
      await this.graph();await this.context.resume();job.signal.throwIfAborted();
      await this.requests().request('daw-export-open',{exportToken:job.token});job.opened=true;
      job.binding={projectId:this.projectId,planId:this.planId,slots:this.slots,boundPatches:this.boundPatches,lastProject:this.lastProject,position:this.position};
      this.speaker.gain.value=0;this.clearEffects();
    }catch(error){if(!job.opened)this.exporting=null;throw error;}
  }
  async endExport(job){
    if(this.exporting!==job)return;
    try{
      if(!job.opened)return;
      await this.requests().request('daw-export-close',{exportToken:job.token});
    }finally{
      this.playing=false;this.clearEffects();if(this.speaker)this.speaker.gain.value=1;
      this.exporting=null;
      if(job.binding){Object.assign(this,job.binding);if(this.lastProject)this.updateMix(this.lastProject);}
    }
  }
  async prepareLive(controller){
    if(this.exporting)throw Error('Wait for audio export to finish');
    const project=controller.snapshot(),slots=assignSlots(project);validateEffects(project);await this.graph();await this.context.resume();
    if(this.playing||this.starting){if(this.projectId!==project.id)throw Error('Stop playback before changing the input project');return;}
    await prepareProjectSamplers(this,project);
    await this.requests().request('daw-stop',{hard:true});const state=await this.requests().request('daw-state-request');this.synchronize(controller,state.patches.map((patch,part)=>({part,patch})));
    const current=controller.snapshot();await this.requests().request('daw-apply',{projectId:project.id,revision:controller.revision,token:state.token,slots:[...slots].map(([id,part])=>({...current.tracks.find(t=>t.id===id).instrument,trackId:id,part}))});
    this.projectId=project.id;this.slots=slots;this.boundPatches=new Map([...slots].map(([id])=>[id,[...instrumentBinding(current.tracks.find(t=>t.id===id).instrument)]]));this.planId||=crypto.randomUUID();await this.configureTracks(current,slots,this.planId);
  }
  async openLive(controller,token){await this.prepareLive(controller);await this.requests().request('daw-live-open',{projectId:controller.snapshot().id,token});this.liveSessionToken=token;for(const track of this.tracks.values())await track.gateRpc.request('live-session',{token});}
  async closeLive(token){if(this.liveSessionToken!==token)return;await this.requests().request('daw-live-close',{token});this.liveSessionToken=null;for(const track of this.tracks.values())track.gate.parameters.get('live').setTargetAtTime(0,this.context.currentTime,.01);}
  liveMix(ids){if(!this.context)return;for(const [id,track] of this.tracks)track.gate.parameters.get('live').setTargetAtTime(ids.has(id)?1:0,this.context.currentTime,.01);}
  updateMix(project,restore=false){
    if(!this.context||!this.bus)return;validateEffects(project);this.masterFx.update(project.master.fx);for(const t of project.tracks)this.tracks.get(t.id)?.effects.update(t.fx);const now=this.context.currentTime;
    this.lastProject=project;
    for(const t of project.tracks){const nodes=this.tracks.get(t.id);if(!nodes)continue;
      for(const [name,value] of [['volume',t.volume],['pan',t.pan],['mute',trackAudible(project,t)?1:0]]){const parameter=nodes.mix.parameters.get(name);parameter.cancelScheduledValues(now);parameter.setTargetAtTime(value,now,.01);}
    }
    this.bus.parameters.get('gain').setTargetAtTime(project.master.volume,now,.01);
  }
  async buffers(project,assets,token){
    const needed=new Set(project.clips.filter(c=>c.type==='audio').map(c=>c.assetId));
    await this.mediaRpc.request('retain',{ids:[...needed]});for(const id of this.decoded.keys())if(!needed.has(id))this.decoded.delete(id);
    for(const id of needed){
      const source=assets.get(id),cached=this.decoded.get(id);if(cached?.source===source)continue;
      const meta=project.assets.find(a=>a.id===id),{left,right}=await this.decodeSource(source,meta.frames);
      if(this.generation!==token)throw Error('Playback preparation cancelled');
      await this.mediaRpc.request('asset',{id,left,right},[left.buffer,right.buffer]);this.decoded.set(id,{source});
    }
    for(const id of this.decoded.keys())if(!needed.has(id))this.decoded.delete(id);
  }
  decodeSource(source,frames){
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./daw-media-worker.js',import.meta.url),{type:'module'}),job={worker};
      const finish=()=>{clearTimeout(timer);worker.terminate();if(this.decodeJob===job)this.decodeJob=null;};
      const timer=setTimeout(()=>{finish();reject(Error('Audio source preparation timed out'));},30000);job.cancel=()=>{finish();reject(Error('Playback preparation cancelled'));};this.decodeJob=job;
      worker.onmessage=({data:m})=>{finish();m.ok?resolve({left:m.left,right:m.right}):reject(Error(m.error));};worker.onerror=()=>{finish();reject(Error('Audio source preparation failed'));};worker.postMessage({source,frames});
    });
  }
  async start(controller,options={}){
    this.discardStaleGraph();
    if(this.starting||this.playing||(this.exporting&&this.exporting.token!==options.exportToken))throw Error('DAW is already preparing, playing or exporting');
    if(this.bridge.isStudioBusy?.())throw Error('Stop Studio before starting DAW');
    const project=controller.snapshot();validateEffects(project);const revision=controller.revision,slots=assignSlots(project,8,options.reservedPart),renderProject=options.excludeClips?{...project,clips:project.clips.filter(c=>!options.excludeClips.has(c.id))}:project,data=compileProject(renderProject,slots,{endFrame:options.exportToken?options.endFrame:undefined}),token=++this.generation,planId=crypto.randomUUID();
    const looping=!!options.loop,length=options.endFrame??(looping?Math.max(data.length,options.loopEnd??data.length):data.length),schedule={length,fromFrame:options.fromFrame??0,loop:looping,loopStart:looping?options.loopStart??0:0,loopEnd:looping?options.loopEnd??length:length},events=data.events.filter(e=>e.frame<length||e.frame===length&&!e.type&&!e.velocity);prepareSchedule({...schedule,events});this.starting=true;this.projectId=project.id;
    const emit=!options.exportToken,check=()=>{options.signal?.throwIfAborted();if(this.generation!==token||this.node!==this.bridge.getAudio().node)throw Error('Playback preparation cancelled');};
    this.planId=planId;this.position=schedule.fromFrame;if(emit)this.onState({playing:false,preparing:true,frame:schedule.fromFrame});
    try{
      await this.graph();await this.context.resume();await this.buffers(project,controller.assets,token);
      if(!options.exportToken)await prepareProjectSamplers(this,project,{signal:options.signal});
      check();if(controller.revision!==revision)throw Error('Project changed during playback preparation');
      const rpc=this.requests();
      const request=(type,data)=>rpc.request(type,{...data,exportToken:options.exportToken});
      await request('daw-stop',{hard:true});const state=await request('daw-state-request');
      if(emit)this.synchronize(controller,state.patches.map((patch,part)=>({part,patch})));if(controller.revision!==revision)throw Error('Project or live instrument changed during preparation; press Play again');
      await request('daw-apply',{projectId:project.id,revision,token:state.token,slots:[...slots].map(([id,part])=>({...project.tracks.find(t=>t.id===id).instrument,trackId:id,part}))});
      this.slots=slots;this.boundPatches=new Map([...slots].map(([id])=>[id,[...instrumentBinding(project.tracks.find(t=>t.id===id).instrument)]]));
      check();
      await this.configureTracks(project,slots,planId);
      const clips=data.audio.map(({clip,track,start})=>{
        const first=Math.round(start*RATE),end=first+clip.frames;
        return {assetId:clip.assetId,output:project.tracks.findIndex(t=>t.id===track.id),start:first,
          end:options.exportToken?Math.min(end,length):end,offset:clip.offset,gain:clip.gain,pan:clip.pan||0,
          fadeIn:clip.fadeIn,fadeOut:clip.fadeOut,envelope:clip.envelope??(options.exportToken&&end>length?{offset:0,frames:clip.frames}:undefined)};
      });
      await this.mediaRpc.request('prepare',{planId,clips});
      await request('daw-plan-begin',{projectId:project.id,revision,planId,count:events.length,data:schedule});
      for(let offset=0;offset<events.length;offset+=1024){check();await request('daw-plan-append',{planId,offset,events:events.slice(offset,offset+1024)});}
      check();
      const startFrame=Math.ceil((this.context.currentTime*RATE+8192+(options.countInFrames||0))/128)*128;
      this.masterMeter.port.postMessage({t:'reset'});this.planId=planId;await options.beforeStart?.({startFrame});check();
      await request('daw-start',{projectId:project.id,revision,startFrame,planId,countInFrames:options.countInFrames||0,recordToken:options.recordToken,tailFrames:options.tailFrames,click:{...(options.click||this.clickSettings||{enabled:false,level:.25}),bpm:project.bpm,meter:project.meter}});
      check();
      this.playing=true;this.startFrame=startFrame;this.length=length;this.schedule=schedule;return {startFrame,length};
    }catch(error){if(emit)await this.stop();throw error;}finally{this.starting=false;}
  }
  stopSources(){this.decodeJob?.cancel();this.sources=[];}
  async stop(hard=false){this.generation++;this.stopSources();this.playing=false;if(this.lastProject)this.updateMix(this.lastProject,true);const node=this.bridge.getAudio().node,result=node&&(this.rpc||this.bus)?await this.requests().request('daw-stop',{hard}):{};this.onState({playing:false,preparing:false,frame:this.position||0,reason:'user'});return result;}
  receive(m){
    if(m.t!=='daw-state'||m.projectId!==this.projectId||m.planId!==this.planId)return;
    if(this.exporting){if(!m.playing&&m.reason!=='ended'&&m.reason!=='export-closed')this.exporting.fail(Error('Export playback stopped: '+m.reason));return;}
    this.playing=m.playing;this.position=m.frame;if(!m.playing){this.stopSources();if(this.lastProject)this.updateMix(this.lastProject,true);}this.onState(m);
  }
  async reset(){this.stopSources();this.decoded.clear();this.projectId=null;this.lastProject=null;this.position=0;this.slots.clear();this.boundPatches.clear();await this.disconnectTracks();this.masterFx?.update([]);if(this.mediaRpc)await this.mediaRpc.request('clear');}
}
