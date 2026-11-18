// SPDX-License-Identifier: GPL-3.0-only
import {RATE,PPQ,LIMITS,uuid,clipSeconds} from './daw-project.js';
import {assignSlots,compileProject} from './daw-playback.js';
import {MidiTake,inputFrame} from './daw-midi-take.js';
import {subscribeDawInput} from './daw-input-events.js';
import {createTake,readTake,listTakes,discardEmptyTake} from './daw-take-store.js';
export const SYNTH_INPUT='waswan:internal-synth';
// Replace is a single controller transaction; immutable prior sources remain in Undo.
export function commitTake(controller,{meta,events=[],audio},endFrame=meta.endFrame??meta.lastFrame){
  const p=controller.snapshot();if(p.id!==meta.projectId)throw Error('Take belongs to another project');if(p.clips.some(c=>c.id===meta.clipId))throw Error('This take is already in the project');const track=p.tracks.find(t=>t.id===meta.trackId);if(track?.type!==meta.kind)throw Error('Recording track is unavailable');
  const commands=[],assets=new Map();if(meta.replaceClipId){const prior=p.clips.find(c=>c.id===meta.replaceClipId);if(!prior||prior.trackId!==track.id)throw Error('Replacement destination changed');commands.push({type:'clip.remove',payload:{id:prior.id}});if(prior.type==='audio'&&!p.clips.some(c=>c.id!==prior.id&&c.assetId===prior.assetId))commands.push({type:'asset.remove',payload:{id:prior.assetId}});}
  let clip;
  if(meta.kind==='midi'){const take=new MidiTake(meta.channel,meta.budget);take.seed(meta.seed,meta.seedFrame);for(const e of events)take.input(e);take.close(null,endFrame);clip=take.clip({...meta,endFrame,name:meta.name});if(!clip.notes.length&&!clip.midiEvents.length)throw Error('No MIDI notes or expression captured');}
  else{const frames=meta.frames,shift=Math.round(meta.offsetMs*RATE/1000),position=Math.max(0,meta.fromFrame-shift),offset=Math.max(0,shift-meta.fromFrame);if(!audio||frames<=offset)throw Error('No audio remains after latency compensation');const source={id:meta.assetId,name:meta.name,sampleRate:RATE,channels:2,frames,bytes:44+frames*4};commands.push({type:'asset.add',payload:source});assets.set(source.id,audio);clip={id:meta.clipId,type:'audio',trackId:track.id,name:meta.name,position:{unit:'seconds',value:position/RATE},assetId:source.id,offset,frames:frames-offset,gain:1,pan:0,fadeIn:0,fadeOut:0};}
  clip.id=meta.clipId;const endTick=clip.type==='midi'?clip.position.value+clip.length:Math.ceil((clip.position.value+clip.frames/RATE)*p.bpm*PPQ/60),length=Math.max(p.length,endTick);if(length!==p.length)commands.push({type:'project.update',payload:{length,...(p.transport?.end===p.length?{transport:{...p.transport,end:length}}:{})}});commands.push({type:'clip.add',payload:clip});
  // Validate playback density and total budgets before registering sources or editing.
  const candidate=structuredClone(p);if(meta.replaceClipId)candidate.clips=candidate.clips.filter(c=>c.id!==meta.replaceClipId);candidate.clips.push(clip);candidate.length=length;if(clip.type==='midi')compileProject(candidate);controller.transaction(commands,assets);return clip;
}
export class DawRecorder {
  constructor(workspace){this.w=workspace;this.busy=false;this.state='idle';this.settings={countIn:1,click:false,clickLevel:.4,midiOffset:0,audioOffset:0,deviceId:'default'};try{Object.assign(this.settings,JSON.parse(localStorage.getItem('waswan-daw-recording-v1')||'{}'));}catch{}if(!Number.isFinite(this.settings.clickLevel)||this.settings.clickLevel<0||this.settings.clickLevel>1)this.settings.clickLevel=.4;}
  get synthInput(){return this.settings.deviceId===SYNTH_INPUT;}
  get clickSettings(){return {enabled:!!this.settings.click,level:this.settings.clickLevel};}
  offsetKey(kind){return kind+':'+(kind==='midi'?(this.w.bridge.midi.input?.id||this.w.bridge.midi.input?.name||'default'):this.settings.deviceId);}
  offset(kind){return this.settings.offsets?.[this.offsetKey(kind)]??0;}
  setOffset(kind,value){this.settings.offsets??={};this.settings.offsets[this.offsetKey(kind)]=value;this.preferences();}
  preferences(){localStorage.setItem('waswan-daw-recording-v1',JSON.stringify(this.settings));}
  status(state,message){this.state=state;this.w.status.textContent=message;this.w.refreshControls();this.w.monitor?.updateMix();}
  async prepareAudio(){
    const {context}=this.w.bridge.getAudio();
    if(this.stream?.active&&this.device===this.settings.deviceId&&this.audioSource?.context===context)return;
    if(this.stream)this.releaseAudio();const stream=await (this.w.viewWindow?.navigator||navigator).mediaDevices.getUserMedia({video:false,audio:{deviceId:this.settings.deviceId==='default'?undefined:{exact:this.settings.deviceId},echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:{ideal:2}}});
    if(!stream.getAudioTracks().length){for(const t of stream.getTracks())t.stop();throw Error('No compatible audio input');}this.stream=stream;this.device=this.settings.deviceId;this.audioSource=context.createMediaStreamSource(stream);for(const track of stream.getAudioTracks())track.onended=()=>{
      if(this.busy)void this.stop('input-disconnected');
      else void this.releaseAudio().then(()=>this.w.refreshControls());
    };
  }
  releaseAudio(){
    this.audioSource?.disconnect();
    for(const t of this.stream?.getTracks()||[]){t.onended=null;t.stop();}
    this.stream=this.audioSource=this.audioMonitorNode=this.audioTrackId=null;
    this.w.monitor?.updateMix();
    return this.w.monitor?.releaseUnusedSession();
  }
  async connectAudio(track){
    await this.prepareAudio();
    try{
      const hadSession=!!this.w.monitor.token;
      await this.w.monitor.ensureSession();
      if(hadSession&&this.w.monitor.needsPreparation(this.w.controller.snapshot()))await this.w.player.prepareLive(this.w.controller);
      this.routeAudio(track.id);
    }catch(error){
      await this.releaseAudio();
      throw error;
    }
  }
  async enableAudio(){
    if(this.w.player.playing)throw Error('Stop playback before changing the audio input');
    const track=this.w.selectedTrack();
    if(track?.type!=='audio')throw Error('Select an audio track');
    await this.connectAudio(track);
  }
  intent(){
    if(this.busy&&this.takeIntent)return this.takeIntent;
    const track=this.w.snapshot.tracks.find(t=>t.arm),clip=this.w.clip();
    const replace=track&&clip?.trackId===track.id&&this.settings.replaceSelected!==false?clip:null;
    return {track,replace,internal:track?.type==='audio'&&this.synthInput};
  }
  routeAudio(id){if(this.audioMonitorNode&&this.audioSource)try{this.audioSource.disconnect(this.audioMonitorNode);}catch{}this.audioMonitorNode=this.w.player.tracks.get(id)?.gate;if(!this.audioMonitorNode)throw Error('Audio track input is unavailable');this.audioSource.connect(this.audioMonitorNode,0,1);this.audioTrackId=id;this.w.monitor.updateMix();}
  inputForTake(context,node){
    if(!this.synthInput)return this.audioSource;
    // Use only the Synth stereo output, upstream of speaker mute. Playback,
    // metronome and DAW MIDI monitoring have their own outputs.
    this.synthTap=context.createGain();
    node.connect(this.synthTap,0,0);
    this.synthNode=node;
    return this.synthTap;
  }
  seed(){const r=this.w.monitor.router;return {pedals:[...r.pedals],bends:[...r.bends],mods:[...r.mods],held:[...r.held].filter(([,e])=>e.trackId===this.track.id).map(([key,e])=>({channel:key>>7,pitch:key&127,velocity:e.velocity}))};}
  async start(){
    if(this.busy||this.w.player.playing||this.w.player.starting||this.w.audition?.busy)throw Error('Stop playback before recording');
    const intent=this.intent(),{track,replace,internal}=intent;
    if(!track)throw Error('Arm one track before Record');
    if(track.type==='midi'&&!track.instrument)throw Error('Choose an instrument before Record');
    if(this.w.bridge.isStudioBusy?.())throw Error('Stop Studio before recording');
    this.takeIntent=intent;this.busy=true;this.track=track;this.cancelled=false;this.discard=false;
    this.status('preparing','Preparing the recovery snapshot');
    try{
      if(internal&&(this.w.monitor.enabled||this.w.monitor.preparing))throw Error('Disable DAW MIDI input to play the Synth while recording its output');
      const reservedPart=internal?(this.w.frame?.track??0):undefined;
      await this.w.player.capture(this.w.controller);
      if(internal)await this.w.player.graph();
      else if(track.type==='audio')await this.connectAudio(track);
      else if(!this.w.monitor.enabled)await this.w.monitor.enable();
      const current=this.w.controller.snapshot(),t=current.transport,fromFrame=t?.loop?Math.round(t.start*60*RATE/(current.bpm*PPQ)):replace?Math.round(clipSeconds(replace,current.bpm)*RATE):this.w.cursor||0,endFrame=t?.loop?Math.round(t.end*60*RATE/(current.bpm*PPQ)):Math.min(RATE*1200,Math.floor(8192*60*RATE/current.bpm)),limit=endFrame-fromFrame;
      if(limit<128)throw Error('Recording interval must contain at least 128 frames');const remaining={...current,clips:current.clips.filter(c=>c.id!==replace?.id)},other=compileProject(remaining,assignSlots(remaining,8,reservedPart)),noteCount=remaining.clips.reduce((n,c)=>n+(c.notes?.length||0),0),eventCount=remaining.clips.reduce((n,c)=>n+(c.midiEvents?.length||0),0),oldAsset=replace?.assetId&&!remaining.clips.some(c=>c.assetId===replace.assetId)?replace.assetId:null,audioBudget=LIMITS.totalFrames-current.assets.reduce((n,a)=>n+(a.id===oldAsset?0:a.frames),0);
      if(track.type==='audio'&&(audioBudget<128||current.assets.length-(oldAsset?1:0)>=LIMITS.assets))throw Error('Audio source budget reached');if(!replace&&current.clips.length>=LIMITS.clips)throw Error('Clip budget reached');
      this.meta={version:1,id:uuid(),clipId:uuid(),assetId:uuid(),kind:track.type,input:internal?'synth':track.type==='audio'?'device':'midi',projectId:current.id,trackId:track.id,name:('Recorded '+track.name).slice(0,120),created:Date.now(),status:'recording',replaceClipId:replace?.id||null,fromFrame,bpm:current.bpm,channel:this.w.monitor.channel,offsetMs:internal?0:Number(this.offset(track.type==='midi'?'midi':'audio')),limit:Math.min(limit,track.type==='audio'?audioBudget:limit),budget:{noteLimit:65536-noteCount,eventLimit:65536-eventCount,playbackBudget:131072-other.events.length}};
      if(!Number.isFinite(this.meta.offsetMs)||Math.abs(this.meta.offsetMs)>2000)throw Error('Latency offset must be between −2000 and 2000 ms');this.store=await createTake(this.meta,this.w.controller);if(this.cancelled)throw Error('Recording cancelled before start');
      this.worker=new Worker(new URL('./daw-record-worker.js',import.meta.url),{type:'module'});this.finished=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});this.finished.catch(()=>{});
      const ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});this.worker.onmessage=({data:m})=>{if(m.t==='ready')this.readyResolve();if(m.t==='timeline-ready')this.timelineResolve?.();if(m.t==='finished')this.resolve(m.meta);if(m.t==='error'){const error=Error(m.message);this.readyReject(error);this.reject(error);if(this.busy&&!this.stopping)void this.stop('storage-error');}};this.worker.onerror=()=>{const error=Error('Recording writer failed');this.readyReject(error);this.reject(error);if(!this.stopping)void this.stop('storage-error');};
      const init={t:'init',meta:this.meta};let transfer=[];if(track.type==='audio'){const {context,node}=this.w.bridge.getAudio();await context.audioWorklet.addModule(new URL('./daw-record-capture.js',import.meta.url));const channel=new MessageChannel();this.capture=new AudioWorkletNode(context,'waswan-daw-capture',{numberOfInputs:2,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});this.captureSource=this.inputForTake(context,node);this.captureSource.connect(this.capture,0,0);this.w.player.clockLink.connect(this.capture,0,1);this.capture.connect(this.w.player.bus);this.capture.port.postMessage({t:'init',token:this.meta.id,limit:this.meta.limit,port:channel.port1},[channel.port1]);init.port=channel.port2;transfer=[channel.port2];}this.worker.postMessage(init,transfer);await Promise.race([ready,new Promise((_,reject)=>{this.readyTimer=setTimeout(()=>reject(Error('Recording writer did not become ready')),10000);})]);clearTimeout(this.readyTimer);if(this.cancelled)throw Error('Recording cancelled before start');
      const {context,node}=this.w.bridge.getAudio();this.takeContext=context;this.takeNode=node;this.lastClockFrame=0;this.meta.seedFrame=Math.round(context.currentTime*RATE);this.meta.seed=this.seed();this.take=new MidiTake(this.meta.channel,this.meta.budget);if(track.type==='midi'){this.take.seed(this.meta.seed,this.meta.seedFrame);this.unsubscribe=subscribeDawInput(e=>this.input(e));}
      if(this.cancelled)throw Error('Recording cancelled before start');const countInFrames=Math.round(Number(this.settings.countIn)*current.meter[0]*4/current.meter[1]*60/current.bpm*RATE),started=await this.w.player.start(this.w.controller,{fromFrame,endFrame:fromFrame+this.meta.limit,loop:false,countInFrames,reservedPart,recordToken:this.meta.id,beforeStart:async({startFrame})=>{this.meta.startFrame=startFrame;const ready=new Promise(resolve=>{this.timelineResolve=resolve;});this.worker.postMessage({t:'timeline',data:{startFrame,seedFrame:this.meta.seedFrame,seed:this.meta.seed}});await Promise.race([ready,new Promise((_,reject)=>{this.timelineTimer=setTimeout(()=>reject(Error('Take timeline could not be checkpointed')),10000);})]);clearTimeout(this.timelineTimer);},excludeClips:new Set(replace?[replace.id]:[]),click:this.clickSettings});if(this.cancelled)throw Error('Recording cancelled before start');this.meta.startFrame=started.startFrame;this.status('count-in',countInFrames?'Count-in · Stop cancels the take':'Starting take');
      this.recordSecond=null;
      this.timer=setInterval(()=>this.progress(context),250);
      void this.finished.then(()=>{if(this.busy&&!this.stopping)void this.stop('arrangement-end');},()=>{});
    }catch(error){await this.abort();throw error;}
  }
  progress(context){
    if(!this.busy||this.stopping)return;
    const frame=Math.round(context.currentTime*RATE),elapsed=frame-this.meta.startFrame;
    this.lastClockFrame=Math.max(this.lastClockFrame||0,frame);
    this.worker?.postMessage({t:'progress',frame});
    if(elapsed>=0){
      const seconds=Math.floor(elapsed/RATE),message='Recording '+this.track.name+' · '+seconds+' s';
      if(this.state==='count-in')this.status('recording',message);
      if(this.state==='recording'&&this.recordSecond!==seconds){this.recordSecond=seconds;this.w.status.textContent=message;}
    }
    if(context.state!=='running')void this.stop('audio-suspended');
    else if(elapsed>=this.meta.limit)void this.stop('arrangement-end');
  }
  input(e){if(this.track?.type!=='midi'||this.stopping||!this.busy||!e.running||!e.listening||e.consumed)return;const event={frame:inputFrame(this.takeContext,e.timeStamp),data:e.data};try{this.take.input(event);this.worker.postMessage({t:'input',event});}catch(error){this.w.error(error);void this.stop('event-limit');}}
  inputReleased(){if(this.busy&&this.track?.type==='midi'&&this.state!=='preparing')void this.stop('input-disconnected');}
  async stop(reason='user'){
    if(!this.busy)return;if(this.state==='preparing'){this.cancelled=true;await this.w.player.stop();return;}if(this.stopping)return this.stopping;
    this.stopping=(async()=>{this.status('finalizing','Finishing take; preserving the prior take until validation');clearInterval(this.timer);this.unsubscribe?.();this.unsubscribe=null;try{if(this.capture)this.capture.port.postMessage({t:'stop',reason});const {context,node}=this.w.bridge.getAudio(),sameAudio=this.takeContext===context&&this.takeNode===node;
      const result=sameAudio?await this.w.player.stop():null,prior=Math.round((this.takeContext?.currentTime||0)*RATE);
      const frame=Math.min(result?.frame??Math.max(prior,this.lastClockFrame||0,this.meta.startFrame),this.meta.startFrame+this.meta.limit);this.meta.endFrame=frame;this.meta.lastFrame=frame;if(this.track.type==='audio')this.capture.port.postMessage({t:'stop',reason});else this.worker.postMessage({t:'finish',reason,endFrame:frame});const meta=await Promise.race([this.finished,new Promise((_,reject)=>{this.stopTimer=setTimeout(()=>reject(Error('Take writer did not finish; its last checkpoint is recoverable')),5000);})]);clearTimeout(this.stopTimer);await this.store.release();this.store=null;
      if(meta.status!=='complete'||!['user','duration-limit','arrangement-end'].includes(reason))throw Error('Take interrupted ('+meta.reason+'); prior take preserved. Use Recover interrupted take for the valid checkpoint.');if(frame<=meta.startFrame||meta.kind==='audio'&&!meta.frames){this.discard=true;this.status('idle','Recording cancelled during count-in; prior take preserved');return;}const saved=await readTake(meta.id),clip=commitTake(this.w.controller,saved);this.w.selected=clip.trackId;this.w.selectedClip=clip.id;this.w.refresh();this.status('idle',clip.name+' · Undo restores the prior take');
    }catch(error){this.w.error(error);}finally{await this.cleanup();this.w.refreshControls();}})();return this.stopping;
  }
  async cleanup(){clearInterval(this.timer);clearTimeout(this.readyTimer);clearTimeout(this.stopTimer);clearTimeout(this.timelineTimer);this.unsubscribe?.();this.unsubscribe=null;this.capture?.disconnect();if(this.capture){for(const source of [this.captureSource,this.w.player.clockLink])try{source?.disconnect(this.capture);}catch{}this.capture.port.close();}this.capture=null;this.captureSource=null;this.take=null;
    if(this.synthTap){try{this.synthNode.disconnect(this.synthTap,0,0);}catch{}this.synthTap.disconnect();}
    this.synthTap=this.synthNode=null;
    if(this.audioSource&&this.audioSource.context!==this.w.bridge.getAudio().context)this.releaseAudio();
    this.takeContext=this.takeNode=null;this.worker?.terminate();this.worker=null;await this.store?.release();this.store=null;await discardEmptyTake(this.meta?.id).catch(()=>{});this.busy=false;this.stopping=null;this.track=this.takeIntent=null;this.state='idle';this.w.monitor?.updateMix();}
  async abort(){await this.w.player.stop().catch(()=>{});await this.cleanup();}
  async recover(id){
    const take=await readTake(id,{baseProject:true});
    const clip=await this.w.adopt(take.loaded,next=>commitTake(next,take));
    this.w.files.forget();this.w.controller.markUnsaved();this.w.auto.schedule();
    this.w.selected=clip.trackId;this.w.selectedClip=clip.id;
    this.w.refresh();this.w.status.textContent='Recovered take checkpoint · save a project file to keep it';
  }
  list(){return listTakes();}
}
