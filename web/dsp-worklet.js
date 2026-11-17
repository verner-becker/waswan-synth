// SPDX-License-Identifier: GPL-3.0-only
import {OberVave} from './worklet-original.js';
import {accumulator,block} from './dsp-stats.js';
import {COMMANDS} from './studio-format.js';
import {StudioClock} from './studio-clock.js';
import {AUTOMATION_TARGETS,readAutomation,applyAutomation} from './studio-automation.js';
class MonitoredOberVave extends OberVave {
 constructor(options){
  super(options);this.enabled=false;this.session=null;this.stats=accumulator();this.elapsed=0;this.voiceElapsed=0;
  this.voices={active:0,gate:0,release:0,capacity:0};
  this.clockName=typeof globalThis.performance?.now==='function'?'performance.now':typeof globalThis.Date?.now==='function'?'Date.now':null;
  this.clock=this.clockName==='performance.now'?()=>globalThis.performance.now():this.clockName?()=>globalThis.Date.now():null;
  const original=this.port.onmessage;
  this.port.onmessage=e=>{
   const m=e.data;
   if(m.t==='studio-sequence-start'){
    try{
     if(!this.engine?.ex.waswan_studio_note)throw Error('Rebuild the simulator to enable Studio MIDI playback');
     this.sequence??=new StudioClock((part,note,velocity)=>{
      const applied=!!this.engine?.ex.waswan_studio_note(part,note,velocity);
      if(applied&&this.studioEvents)this.studioEvents.postMessage({t:'command',frame:currentFrame,command:{t:'studio-note',part,note,velocity}});
      return applied;
     },state=>this.port.postMessage({t:'studio-sequence-state',...state,startFrame:this.sequence?.startFrame}),
     (id,value)=>applyAutomation(this.engine,id,value),(id,value)=>applyAutomation(this.engine,id,value));
     const start=Number.isSafeInteger(m.startFrame)&&m.startFrame>currentFrame&&m.startFrame<currentFrame+sampleRate*2?m.startFrame:currentFrame+2048;
     this.sequence.start(m.data,start);
    }catch(error){this.sequence?.stop('invalid-schedule');this.port.postMessage({t:'studio-sequence-state',playing:false,frame:0,error:error.message});}
    return;
   }
   if(m.t==='studio-sequence-stop'){this.sequence?.stop();return;}
   if(m.t==='studio-context-apply'){
    try{if(this.sequence?.active)throw Error('Stop Studio MIDI before applying tones');this.engine.restoreStudioContext(m.context,m.token);this.port.postMessage({t:'studio-context-applied',request:m.request,ok:true});}
    catch(error){this.port.postMessage({t:'studio-context-applied',request:m.request,ok:false,error:error.message});}return;
   }
   if(m.t==='studio-context'){
    try{
     const x=this.engine.ex,hash=this.engine.storeHash,store=this.engine.store(true);this.engine.storeHash=hash;
     this.port.postMessage({t:'studio-context',request:m.request,context:{version:1,tempo:x.sim_tempo(),master:x.sim_master_current(),selectedPart:x.sim_track(),token:x.waswan_studio_context_token?.()>>>0,
      expression:x.waswan_studio_expression_value?Array.from({length:3},(_,f)=>x.waswan_studio_expression_value(f)):undefined,midiSustain:!!x.waswan_midi_sustain(),
      mixer:x.waswan_studio_mix_value?Array.from({length:4},(_,p)=>Array.from({length:8},(_,f)=>x.waswan_studio_mix_value(p,f))):undefined,
      parts:Array.from({length:4},(_,part)=>({program:x.sim_program(part)+1,engine:x.sim_engine_patch(part),parameters:Array.from({length:x.waswan_parameter_count()},(_,p)=>x.sim_param(part,p)),patch:x.waswan_studio_patch?Array.from({length:80},(_,i)=>x.waswan_studio_patch(part,i)):undefined}))},store},[store]);
    }catch(error){this.port.postMessage({t:'studio-context',request:m.request,error:error.message});}
    return;
   }
   if(m.t==='studio-events-connect'){this.studioEvents?.close();this.studioEvents=m.port;this.studioPrevious=readAutomation(this.engine);this.studioValues=Array(AUTOMATION_TARGETS.length);return;}
   if(m.t==='studio-events-disconnect'){this.studioEvents?.close();this.studioEvents=null;return;}
   if(m.t==='dsp-control'){
    if(m.action==='stop')this.publish(true,'user');
    else if(m.action==='start'){if(this.session)this.publish(true,'replaced');this.session=m.session;this.enabled=true;this.reset();}
    else if(m.action==='enable'){if(this.session)this.publish(true,'disabled');this.enabled=!!m.enabled;this.reset();}
   }else {
    if(m.t==='reboot'){this.sequence?.stop('instrument-reboot');if(this.session)this.publish(true,'reboot');}
    if(this.studioEvents&&COMMANDS.has(m.t))this.studioEvents.postMessage({t:'command',frame:currentFrame,command:m});
    original(e);
   }
  };
 }
 reset(){this.stats=accumulator();this.elapsed=0;this.voiceElapsed=1;}
 sampleVoices(){const x=this.engine?.ex;if(!x)return;let active=0,gate=0;const capacity=x.waswan_voice_limit();
  for(let i=0;i<capacity;i++){const a=!!x.waswan_voice(i,0);if(a){active++;if(x.waswan_voice(i,1))gate++;}}
  this.voices={active,gate,release:active-gate,capacity};this.stats.peakVoices=Math.max(this.stats.peakVoices,active);
 }
 publish(final=false,reason=null){
  if(!this.enabled)return;
  this.sampleVoices();this.port.postMessage({t:'dsp-window',session:this.session,final,reason,stats:this.stats,voices:this.voices,sampleRate,
   measurement:{state:this.clock?'available':'unavailable',clock:this.clockName??'none',quality:this.clockName==='Date.now'?'coarse-wall-clock':this.clock?'histogram-approximate':'no-worklet-duration-clock',nominalResolutionMs:this.clockName==='Date.now'?1:null,binMs:0.025,voiceSamplingHz:25,scope:'host-process-including-studio-scheduling-copy-frame-store'}});
  this.stats=accumulator();this.elapsed=0;
  if(final)this.session=null;
 }
 process(inputs,outputs){
  const frames=outputs[0]?.[0]?.length||0,start=this.enabled&&this.clock?this.clock():null;
  if(this.sequence?.active)this.sequence.tick(currentFrame);
  const result=super.process(inputs,outputs);
  if(this.studioEvents&&this.engine){
   const next=readAutomation(this.engine,this.studioValues),previous=this.studioPrevious;
   for(let i=0;i<next.length;i++)if(next[i]!==null&&next[i]!==previous[i])this.studioEvents.postMessage({t:'parameter',frame:currentFrame+frames,target:AUTOMATION_TARGETS[i].id,value:next[i]});
   this.studioPrevious=next;this.studioValues=previous;
  }
  if(!this.enabled)return result;
  const ms=this.clock?this.clock()-start:null;
  block(this.stats,ms,frames,sampleRate);this.elapsed+=frames/sampleRate;this.voiceElapsed+=frames/sampleRate;
  if(this.voiceElapsed>=.04){this.sampleVoices();this.voiceElapsed=0;}
  if(this.elapsed>=1)this.publish();
  if(!this.engine&&this.session)this.publish(true,'engine-error');
  return result;
 }
}
registerProcessor('obervave-smk37',MonitoredOberVave);
