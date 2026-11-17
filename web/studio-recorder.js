// SPDX-License-Identifier: GPL-3.0-only
import {RATE,MAX_FRAMES,MAX_JSON,validateProject,readProject,projectBlob,wavHeader} from './studio-format.js';
import {listenStudioInput} from './studio-events.js';

const busyStates=['starting','recording','finalizing','loading'];
const base64=buffer=>{let text='';for(const byte of new Uint8Array(buffer))text+=String.fromCharCode(byte);return btoa(text);};
export class StudioRecorder {
  constructor(bridge){
    this.bridge=bridge;this.state='idle';this.frames=0;this.eventCount=0;this.message='Ready for a new take';this.onChange=()=>{};
    addEventListener('pagehide',()=>this.stop('page-hidden'));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop('page-hidden');});
  }
  get busy(){return busyStates.includes(this.state);}
  changed(){this.onChange(this);}
  async snapshot(node){
    const request=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Instrument context did not respond'));},5000);
      const receive=({data:m})=>{
        if(m.t!=='studio-context'||m.request!==request)return;
        clearTimeout(timer);node.port.removeEventListener('message',receive);
        if(m.error)reject(Error(m.error));else resolve({...m.context,session:base64(m.store)});
      };
      node.port.addEventListener('message',receive);node.port.postMessage({t:'studio-context',request});
    });
  }
  async start(){
    if(this.busy)return;
    const {context,node}=this.bridge.getAudio();
    if(!context||!node||context.state!=='running')throw Error('Start or resume audio before recording');
    if(!navigator.storage?.getDirectory)throw Error('Local recording requires OPFS in a supported desktop browser');
    const generation=(this.generation||0)+1;this.generation=generation;
    this.stopPlayback();this.state='starting';this.message='Preparing local recording';this.changed();
    try{
      const snapshot=await this.snapshot(node);
      if(this.generation!==generation||this.state!=='starting')return;
      if(!this.captureModule){await context.audioWorklet.addModule(new URL('./studio-capture.js',import.meta.url));this.captureModule=context;}
      if(this.generation!==generation||this.state!=='starting')return;
      this.audioContext=context;this.instrument=node;
      this.worker=new Worker(new URL('./studio-worker.js',import.meta.url),{type:'module'});
      this.worker.onerror=()=>this.failed('Recording worker stopped; recover the local take');
      this.worker.onmessage=({data:m})=>void this.receive(m);
      this.capture=new AudioWorkletNode(context,'waswan-studio-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
      this.capture.onprocessorerror=()=>this.stop('capture-error');
      node.connect(this.capture);this.capture.connect(context.destination);
      const events=new MessageChannel();
      node.port.postMessage({t:'studio-events-connect',port:events.port1},[events.port1]);
      this.frames=0;this.eventCount=0;
      this.worker.postMessage({t:'init',context:snapshot,port:this.capture.port,eventPort:events.port2},[this.capture.port,events.port2]);
      this.suspension=()=>{if(context.state!=='running')this.stop('audio-suspended');};context.addEventListener('statechange',this.suspension);
      this.startTimer=setTimeout(()=>{if(this.state==='starting')this.failed('Local recording did not start');},8000);
    }catch(error){if(this.generation===generation){this.failed(error.message);throw error;}}
  }
  async receive(m){
    if(m.t==='started'){
      clearTimeout(this.startTimer);this.id=m.id;this.firstFrame=m.first;this.take=null;if(this.state==='finalizing')return;
      this.state='recording';this.message='Recording · synth output before monitoring mute';
      listenStudioInput(raw=>{
        if(this.state!=='recording'||!raw.running||raw.data[0]<128||raw.data[0]>=240)return;
        const now=performance.now(),receivedFrame=Math.round(this.audioContext.currentTime*RATE);
        const age=Number.isFinite(raw.timeStamp)&&Math.abs(raw.timeStamp-now)<5000?raw.timeStamp-now:0;
        this.worker.postMessage({t:'input',frame:receivedFrame+Math.round(age*RATE/1000),receivedFrame,data:raw.data,listening:raw.listening});
      });
    }
    if(m.t==='progress'){this.frames=m.frames;this.eventCount=m.eventCount;}
    if(m.t==='finished'){
      this.cleanup();
      try{this.take=await this.readLocal(m.id);this.frames=m.frames;this.eventCount=m.eventCount;this.state='ready';this.message=m.status==='complete'?(m.reason==='duration-limit'?'Take ready · 20 minute limit reached':'Take ready'):'Incomplete take · use Save project to preserve the recovered audio';}
      catch(error){this.failed(error.message);return;}
    }
    if(m.t==='error'){this.failed(m.message);return;}
    this.changed();
  }
  stop(reason='user'){
    if(!['starting','recording'].includes(this.state))return;
    if(this.state==='starting'&&!this.worker){this.generation++;this.state='idle';this.message='Recording cancelled';this.changed();return;}
    this.state='finalizing';this.message='Finalizing local take';listenStudioInput(null);this.worker?.postMessage({t:'stop',reason});this.changed();
    clearTimeout(this.stopTimer);this.stopTimer=setTimeout(()=>{if(this.state==='finalizing')this.failed('Recording interrupted; use Recover local take');},5000);
  }
  cleanup(){
    clearTimeout(this.startTimer);clearTimeout(this.stopTimer);listenStudioInput(null);
    if(this.capture){try{this.instrument.disconnect(this.capture);}catch{}try{this.capture.disconnect();}catch{}this.capture=null;}
    this.instrument?.port.postMessage({t:'studio-events-disconnect'});
    this.audioContext?.removeEventListener('statechange',this.suspension);
    this.worker?.terminate();this.worker=null;
  }
  failed(message){this.cleanup();this.state='error';this.message=message;this.changed();}
  async readLocal(id){
    const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('waswan-studio-v1');
    const dir=await root.getDirectoryHandle(id),metadataFile=await(await dir.getFileHandle('take.json')).getFile();
    if(metadataFile.size>1024*1024)throw Error('Invalid local metadata size');
    const metadata=JSON.parse(await metadataFile.text()),file=await(await dir.getFileHandle('audio.wav')).getFile();
    if(file.size<48||file.size>44+MAX_FRAMES*4)throw Error('No recoverable audio in local take');
    const frames=Math.floor((file.size-44)/4),status=metadata.status==='complete'&&metadata.frames===frames?'complete':'incomplete';
    const log=await(await dir.getFileHandle('events.jsonl')).getFile();if(log.size>MAX_JSON)throw Error('Local event log exceeds limit');
    const events=[];
    for(const line of (await log.text()).split('\n')){
      if(!line)continue;
      try{const e=JSON.parse(line);if(e.frame<=frames)events.push(e);}catch{if(status==='complete')throw Error('Corrupted event log');break;}
    }
    const project=validateProject({...metadata,frames,status,events});
    // Rebuild the header for interrupted writes; original PCM is never modified.
    return {project,audio:new Blob([wavHeader(frames),file.slice(44,44+frames*4)],{type:'audio/wav'})};
  }
  async recover(){
    if(this.busy)return;
    const previous=this.state;this.state='loading';this.message='Loading local take';this.changed();
    try{
    this.stopPlayback();
    const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('waswan-studio-v1');
    const ids=[];for await(const [name,handle] of root.entries())if(handle.kind==='directory'&&/^take-\d+-[a-f0-9-]+$/.test(name))ids.push(name);
    for(const id of ids.sort().reverse()){
      try{const take=await this.readLocal(id);this.beforeReplace?.();this.take=take;this.frames=this.take.project.frames;this.eventCount=this.take.project.events.length;this.state='ready';this.message=`Recovered local take · ${this.take.project.status}`;this.changed();return;}catch{}
    }
    throw Error('No recoverable local take');
    }catch(error){this.state=previous;this.message=error.message;this.changed();throw error;}
  }
  async open(file){
    if(this.busy)throw Error('Stop recording before opening a project');
    const previous=this.state;this.state='loading';this.message='Opening project';this.changed();
    try{
      const take=await readProject(file);this.beforeReplace?.();this.stopPlayback();this.take=take;this.frames=take.project.frames;this.eventCount=take.project.events.length;this.state='ready';this.message='Project opened · current synth unchanged';this.changed();
    }catch(error){this.state=previous;this.message=error.message;this.changed();throw error;}
  }
  async ensureProject(sequence){
    if(this.busy)throw Error('Finish recording or loading before saving MIDI');
    const {node}=this.bridge.getAudio();if(!node)throw Error('Start audio before saving instrument context');
    const previous=this.state;this.state='loading';this.message='Saving MIDI context';this.changed();
    try{
      const context=await this.snapshot(node);
      if(!this.take){this.take={project:{format:'waswan-studio-project',version:1,name:'MIDI composition',status:'complete',frames:0,sampleRate:RATE,channels:2,context,events:[],sequence:structuredClone(sequence)},audio:new Blob([wavHeader(0)],{type:'audio/wav'})};this.frames=0;this.eventCount=0;}
      this.take.project.sequenceContext=context;this.state='ready';this.message='MIDI project ready';this.changed();
    }catch(error){this.state=previous;this.message=error.message;this.changed();throw error;}
  }
  async applyContext(){
    if(this.busy||!this.take)throw Error('Load a project and finish the current operation first');
    if(this.canApplyContext&&!this.canApplyContext())throw Error('Stop Studio and Legacy playback before applying tones');
    const {node}=this.bridge.getAudio();if(!node)throw Error('Start audio before applying saved tones');
    const context=this.take.project.sequenceContext||this.take.project.context;
    if(!context.parts.every(p=>p.patch))throw Error('This older project has no full tone snapshot; audio and MIDI remain available');
    if(!confirm('Apply saved tones and mixer to all four parts? Current unsaved live edits will be replaced. Preset slots are not written.'))return;
    const previous=this.state;this.state='loading';this.message='Applying saved instrument context';this.changed();
    try{
      const current=await this.snapshot(node),request=crypto.randomUUID();
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Instrument did not acknowledge context'));},5000);
        const receive=({data:m})=>{if(m.t!=='studio-context-applied'||m.request!==request)return;clearTimeout(timer);node.port.removeEventListener('message',receive);if(m.ok)resolve();else reject(Error(m.error));};
        node.port.addEventListener('message',receive);node.port.postMessage({t:'studio-context-apply',request,context,token:current.token});
      });
      this.state=previous;this.message='Saved tones and mixer applied to live RAM · use TONES Save to write a preset';this.changed();
    }catch(error){this.state=previous;this.message=error.message;this.changed();throw error;}
  }
  download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  exportWav(){if(this.take?.project.frames&&!this.busy)this.download(this.take.audio,'waswan-take.wav');}
  exportProject(){if(this.take&&!this.busy)this.download(projectBlob(this.take.project,this.take.audio),'waswan-project.wsproj');}
  async play(){
    if(!this.take?.project.frames||this.busy)return;this.stopPlayback();
    const {context,gain}=this.bridge.getAudio();if(!context||!gain)throw Error('Start audio before listening to a take');
    await context.resume();this.playURL=URL.createObjectURL(this.take.audio);this.player=new Audio(this.playURL);
    this.playerSource=context.createMediaElementSource(this.player);this.playerSource.connect(gain);
    this.player.onended=()=>{this.stopPlayback();this.changed();};await this.player.play();this.message='Playing recorded audio';this.changed();
  }
  stopPlayback(){
    if(this.player){this.player.pause();this.player.removeAttribute('src');this.player.load();this.player=null;if(this.state==='ready')this.message='Take ready';}
    this.playerSource?.disconnect();this.playerSource=null;
    if(this.playURL)URL.revokeObjectURL(this.playURL);this.playURL=null;
  }
}
