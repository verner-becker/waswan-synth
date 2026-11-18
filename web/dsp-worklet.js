// SPDX-License-Identifier: GPL-3.0-only
import {OberVave} from './worklet-original.js';
import {accumulator,block} from './dsp-stats.js';
import {COMMANDS} from './studio-format.js';
import {StudioClock} from './studio-clock.js';
import {DawClock,audioTransport} from './daw-playback.js';
import {ScheduleBuilder} from './daw-transport.js';
import {AUTOMATION_TARGETS,readAutomation,applyAutomation} from './studio-automation.js';
class MonitoredOberVave extends OberVave {
 constructor(options){
  super(options);this.enabled=false;this.session=null;this.stats=accumulator();this.elapsed=0;this.voiceElapsed=0;
  this.dawOutputs=!!options.processorOptions?.dawOutputs;
  if(this.dawOutputs&&this.engine)this.dawParts=this.engine.ex.waswan_daw_taps?.(1)||0;
  this.voices={active:0,gate:0,release:0,capacity:0};
  this.clockName=typeof globalThis.performance?.now==='function'?'performance.now':typeof globalThis.Date?.now==='function'?'Date.now':null;
  this.clock=this.clockName==='performance.now'?()=>globalThis.performance.now():this.clockName?()=>globalThis.Date.now():null;
  const original=this.port.onmessage;
  this.port.onmessage=e=>{
   const m=e.data;
   if(typeof m.t==='string'&&m.t.startsWith('daw-')){
    try{
     if(typeof m.request!=='string'||!/^[\w-]{1,80}$/.test(m.request))throw Error('Invalid DAW request ID');
     const x=this.engine?.ex;if(!x?.waswan_daw_capacity?.())throw Error('Rebuild the 256-voice simulator to enable the DAW runtime');
     let result;
     if(m.t==='daw-state-request')result={capacity:x.waswan_daw_capacity(),token:x.waswan_daw_token()>>>0,patches:Array.from({length:x.waswan_daw_capacity()},(_,p)=>Array.from({length:80},(_,i)=>x.waswan_daw_patch(p,i)))};
     else if(m.t==='daw-program'){
      if(!Number.isInteger(m.program)||m.program<0||m.program>98||!x.waswan_daw_program(0,m.program))throw Error('Invalid instrument program');
      result={patch:Array.from(new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer(),80)),engine:x.waswan_daw_staged_engine(0)};
     }else if(m.t==='daw-apply'){
      if(this.sequence?.active||this.daw?.active||x.waswan_ui_playing())throw Error('Stop the active transport before preparing DAW instruments');
      if(typeof m.projectId!=='string'||!/^[\w-]{1,80}$/.test(m.projectId)||!Number.isSafeInteger(m.revision)||m.revision<0||!Array.isArray(m.slots)||m.slots.length>x.waswan_daw_capacity())throw Error('Invalid instrument transaction');
      let mask=0;const stage=new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer(),80*x.waswan_daw_capacity());
      for(const slot of m.slots){
       if(!Number.isInteger(slot.part)||slot.part<0||slot.part>=x.waswan_daw_capacity()||mask>>slot.part&1||!['analog','super','drumx'].includes(slot.type)||!Array.isArray(slot.patch)||slot.patch.length!==80||!slot.patch.every(v=>Number.isInteger(v)&&v>=0&&v<=255))throw Error('Invalid instrument slot');
       stage.set(slot.patch,slot.part*80);const engine=x.waswan_daw_staged_engine(slot.part);
       if(engine<0||engine!==(slot.type==='drumx'?2:0))throw Error('Instrument snapshot is invalid or unavailable in this slot');mask|=1<<slot.part;
      }
      if(!Number.isInteger(m.token)||m.token<0||m.token>0xffffffff||!x.waswan_daw_apply(mask,m.token))throw Error('Instrument changed or notes are still sounding; release notes before applying a different sound');
      this.dawProject={id:m.projectId,revision:m.revision};this.dawObservedToken=x.waswan_daw_token()>>>0;this.dawObserved=new Map(m.slots.map(s=>[s.part,[...s.patch]]));this.dawPoll=0;this.dawOutputs='owned';this.dawParts=x.waswan_daw_taps(1);result={mask,token:this.dawObservedToken};
     }else if(m.t==='daw-plan-begin'){
      if(this.sequence?.active||this.daw?.active||x.waswan_ui_playing()||m.projectId!==this.dawProject?.id||m.revision!==this.dawProject?.revision||typeof m.planId!=='string'||!/^[\w-]{1,80}$/.test(m.planId)||!Number.isSafeInteger(m.count)||m.count<0||m.count>131072)throw Error('Invalid playback plan');
      this.dawPending={planId:m.planId,count:m.count,builder:new ScheduleBuilder(m.data,x.waswan_daw_capacity())};result={prepared:0};
     }else if(m.t==='daw-plan-append'){
      const pending=this.dawPending;if(!pending||pending.planId!==m.planId||m.offset!==pending.builder.events.length||m.events?.length+pending.builder.events.length>pending.count)throw Error('Stale playback plan');
      pending.builder.append(m.events);result={prepared:pending.builder.events.length};
     }else if(m.t==='daw-start'){
      if(this.sequence?.active||x.waswan_ui_playing())throw Error('Stop Studio and Legacy before starting DAW');
      if(m.projectId!==this.dawProject?.id||m.revision!==this.dawProject?.revision)throw Error('Project changed during playback preparation');
      if(!Number.isSafeInteger(m.startFrame)||m.startFrame<currentFrame+128||m.startFrame>currentFrame+sampleRate*2)throw Error('Playback preparation missed its start time; try Play again');
      const pending=this.dawPending;if(!pending||pending.planId!==m.planId||pending.builder.events.length!==pending.count)throw Error('Playback plan is incomplete');const prepared=pending.builder.finish();this.dawPending=null;
      this.daw??=new DawClock((part,note,velocity)=>!!this.engine?.ex.waswan_daw_note(part,note,velocity),()=>this.engine?.ex.waswan_daw_stop(0),state=>{audioTransport.playing=state.playing;if(state.startFrame!==undefined)audioTransport.startFrame=state.startFrame;if(!state.playing)this.engine?.ex.waswan_daw_transport_guard?.(0);this.port.postMessage({t:'daw-state',projectId:this.dawProject?.id,planId:this.dawPlanId,...state});},x.waswan_daw_capacity());
      this.dawPlanId=m.planId;this.daw.startPrepared(prepared,m.startFrame);Object.assign(audioTransport,{...prepared,events:undefined,initial:undefined,repeated:undefined,planId:m.planId,startFrame:m.startFrame,playing:true});x.waswan_daw_transport_guard(1);result={startFrame:m.startFrame};
     }else if(m.t==='daw-stop'){this.daw?.stop();this.dawPending=null;audioTransport.playing=false;audioTransport.planId=null;x.waswan_daw_transport_guard(0);x.waswan_daw_stop(m.hard?1:0);result={stopped:true};}
     else throw Error('Unknown DAW command');
     this.port.postMessage({t:'daw-reply',request:m.request,ok:true,result});
    }catch(error){if(['daw-plan-begin','daw-plan-append','daw-start'].includes(m.t))this.dawPending=null;this.port.postMessage({t:'daw-reply',request:m.request,ok:false,error:error.message});}
    return;
   }
   if(this.daw?.active&&m.t==='btn'&&[16,17].includes(m.b)){if(m.down)this.port.postMessage({t:'daw-notice',message:'Stop DAW before using the Legacy transport'});return;}
   if(m.t==='studio-sequence-start'){
    try{
     if(this.daw?.active)throw Error('Stop DAW before starting Studio');
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
    try{if(this.sequence?.active||this.daw?.active)throw Error('Stop DAW and Studio MIDI before applying tones');this.engine.restoreStudioContext(m.context,m.token);this.port.postMessage({t:'studio-context-applied',request:m.request,ok:true});}
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
    if(m.t==='reboot'){this.sequence?.stop('instrument-reboot');this.daw?.stop('instrument-reboot');this.dawProject=null;this.dawObserved=null;this.dawPending=null;audioTransport.playing=false;audioTransport.planId=null;if(this.session)this.publish(true,'reboot');}
    if(this.studioEvents&&COMMANDS.has(m.t))this.studioEvents.postMessage({t:'command',frame:currentFrame,command:m});
    original(e);
    if(m.t==='reboot'&&this.dawOutputs)this.dawParts=this.engine?.ex.waswan_daw_taps?.(1)||0;
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
  if(this.daw?.active){if(!this.engine)this.daw.stop('engine-error');else if(this.engine.ex.sim_midi_mode?.())this.daw.stop('midi-mode');else if(this.engine.ex.waswan_ui_playing())this.daw.stop('legacy-transport');else this.daw.tick(currentFrame);}
  const result=super.process(inputs,outputs);
  if(!this.engine&&this.daw?.active)this.daw.stop('engine-error');
  if(this.engine&&this.dawProject){
   this.dawPoll+=frames;
   if(this.dawPoll>=1764){
    this.dawPoll=0;const x=this.engine.ex,token=x.waswan_daw_token()>>>0;
    if(token!==this.dawObservedToken){
     const changes=[];
     for(const [part,previous] of this.dawObserved){const patch=Array.from({length:80},(_,i)=>x.waswan_daw_patch(part,i));if(patch.some((v,i)=>v!==previous[i])){changes.push({part,patch});this.dawObserved.set(part,patch);}}
     this.dawObservedToken=token;if(changes.length)this.port.postMessage({t:'daw-instruments-changed',projectId:this.dawProject.id,changes});
    }
   }
  }
  if(this.dawOutputs&&this.engine){
   const x=this.engine.ex;
   for(let p=0;p<this.dawParts;p++)for(let c=0;c<2;c++){
    const output=outputs[p+1]?.[c],pointer=this.dawOutputs==='owned'?x.waswan_daw_owned_output?.(p,c):x.waswan_daw_output?.(p,c);
    if(output&&pointer)output.set(new Float32Array(x.memory.buffer,pointer,output.length));
   }
  }
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
