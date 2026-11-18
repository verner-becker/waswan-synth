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
     if((this.dawExport||m.exportToken)&&m.t!=='daw-export-open'&&
       (m.exportToken!==this.dawExport?.token||!['daw-export-close','daw-state-request','daw-apply','daw-plan-begin','daw-plan-append','daw-start','daw-stop'].includes(m.t)))throw Error('Audio export has exclusive use of the instrument');
     if(m.t==='daw-export-open'){
      if(typeof m.exportToken!=='string'||!/^[\w-]{1,80}$/.test(m.exportToken)||this.dawExport||this.sequence?.active||this.daw?.active||this.dawLiveSession||this.dawPreview||!x.waswan_daw_export_open())throw Error('Stop other transports and inputs, release keys and sustain, and let the instrument fall silent before exporting');
      this.dawExport={token:m.exportToken,project:this.dawProject,observed:this.dawObserved,observedToken:this.dawObservedToken,outputs:this.dawOutputs,parts:this.dawParts};
      audioTransport.exportToken=m.exportToken;result={opened:true};
     }else if(m.t==='daw-export-close'){
      this.daw?.stop('export-closed');this.dawPending=null;
      Object.assign(audioTransport,{playing:false,recording:false,planId:null,exportToken:null,exportPlan:null});
      x.waswan_daw_export_close();const previous=this.dawExport;this.dawExport=null;
      this.dawProject=previous.project;this.dawObserved=previous.observed;this.dawObservedToken=previous.observedToken;this.dawOutputs=previous.outputs;this.dawParts=previous.parts;result={closed:true};
     }else if(m.t==='daw-state-request')result={capacity:x.waswan_daw_capacity(),token:x.waswan_daw_token()>>>0,slots:x.waswan_daw_active_slots?.()||0,liveHeld:Array.from({length:x.waswan_daw_capacity()},(_,p)=>x.waswan_daw_live_held?.(p)||0),patches:Array.from({length:x.waswan_daw_capacity()},(_,p)=>Array.from({length:80},(_,i)=>x.waswan_daw_patch(p,i)))};
     else if(m.t==='daw-program'){
      if(!Number.isInteger(m.program)||m.program<0||m.program>98||!x.waswan_daw_program(0,m.program))throw Error('Invalid instrument program');
      result={patch:Array.from(new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer(),80)),engine:x.waswan_daw_staged_engine(0)};
     }else if(m.t==='daw-drum-catalog'||m.t==='daw-drum-kit'){
      const count=x.waswan_daw_drum_kits?.()||0;
      const patch=kit=>{
       if(!Number.isInteger(kit)||kit<0||kit>=count||!x.waswan_daw_drum_kit(kit))throw Error('Invalid drum kit');
       return Array.from(new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer(),80));
      };
      result=m.t==='daw-drum-kit'?{engine:2,patch:patch(m.kit)}:
       Array.from({length:count},(_,kit)=>({kit,name:String.fromCharCode(...patch(kit).slice(63,73)).replace(/\0/g,'').trim()}));
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
     }else if(m.t==='daw-live-open'){
      if(m.projectId!==this.dawProject?.id||typeof m.token!=='string'||!/^[\w-]{1,80}$/.test(m.token)||!x.waswan_daw_live_note)throw Error('Prepare the project instruments before enabling input');
      if(this.dawLiveSession?.token!==m.token)x.waswan_daw_live_stop(0xffffffff,1);this.dawLiveSession={projectId:m.projectId,token:m.token};audioTransport.liveSession=m.token;this.dawOutputs='owned';this.dawParts=x.waswan_daw_taps(1);result={opened:true};
     }else if(m.t==='daw-live-close'){
      if(this.dawLiveSession?.token===m.token){x.waswan_daw_live_stop(0xffffffff,1);this.dawLiveSession=null;audioTransport.liveSession=null;}result={closed:true};
     }else if(['daw-live-note','daw-live-pedal','daw-live-expression','daw-live-stop-part'].includes(m.t)){
      if(this.dawLiveSession?.token!==m.token||m.projectId!==this.dawLiveSession?.projectId)throw Error('Live input session changed');
      if(!Number.isInteger(m.part)||m.part<0||m.part>=x.waswan_daw_capacity())throw Error('Invalid live input part');
      const channel=m.channel??0;if(!Number.isInteger(channel)||channel<0||channel>15)throw Error('Invalid live input channel');
      if(m.t==='daw-live-note'){if(!Number.isInteger(m.note)||m.note<0||m.note>127||!Number.isInteger(m.velocity)||m.velocity<0||m.velocity>127||!x.waswan_daw_live_note_channel(m.part,channel,m.note,m.velocity))throw Error('Invalid or unavailable live note');}
      if(m.t==='daw-live-pedal'){if(![0,1].includes(m.down)||!x.waswan_daw_live_pedal_channel(m.part,channel,m.down))throw Error('Invalid live pedal');}
      if(m.t==='daw-live-expression'){if(!Number.isInteger(m.bend)||m.bend< -8192||m.bend>8191||!Number.isInteger(m.modulation)||m.modulation<0||m.modulation>127||!x.waswan_daw_live_expression_channel(m.part,channel,m.bend,m.modulation))throw Error('Invalid live expression');}
      if(m.t==='daw-live-stop-part'){if(m.allChannels)x.waswan_daw_live_stop(m.part,1);else x.waswan_daw_live_stop_channel(m.part,channel,1);}result={applied:true};
     }else if(m.t==='daw-preview-open'){
      if(this.sequence?.active||this.daw?.active||x.waswan_ui_playing()||m.projectId!==this.dawProject?.id||typeof m.token!=='string'||!/^[\w-]{1,80}$/.test(m.token)||!Number.isInteger(m.part)||m.part<0||m.part>=x.waswan_daw_capacity()||!(x.waswan_daw_active_slots()>>m.part&1))throw Error('Piano preview requires a prepared instrument and stopped transport');
      x.waswan_daw_stop(1);this.dawPreview={token:m.token,part:m.part};audioTransport.previewSession=m.token;result={opened:true};
     }else if(m.t==='daw-preview-note'){
      if(this.dawPreview?.token!==m.token||this.daw?.active||!Number.isInteger(m.note)||m.note<0||m.note>127||!Number.isInteger(m.velocity)||m.velocity<0||m.velocity>127||!x.waswan_daw_note(this.dawPreview.part,m.note,m.velocity))throw Error('Stale or unavailable piano preview');result={applied:true};
     }else if(m.t==='daw-preview-close'){
      if(this.dawPreview?.token===m.token){x.waswan_daw_stop(1);this.dawPreview=null;audioTransport.previewSession=null;}result={closed:true};
     }else if(m.t==='daw-plan-begin'){
      if(this.sequence?.active||this.daw?.active||x.waswan_ui_playing()||m.projectId!==this.dawProject?.id||m.revision!==this.dawProject?.revision||typeof m.planId!=='string'||!/^[\w-]{1,80}$/.test(m.planId)||!Number.isSafeInteger(m.count)||m.count<0||m.count>131072)throw Error('Invalid playback plan');
      this.dawPending={planId:m.planId,count:m.count,builder:new ScheduleBuilder(m.data,x.waswan_daw_capacity())};result={prepared:0};
     }else if(m.t==='daw-plan-append'){
      const pending=this.dawPending;if(!pending||pending.planId!==m.planId||m.offset!==pending.builder.events.length||m.events?.length+pending.builder.events.length>pending.count)throw Error('Stale playback plan');
      pending.builder.append(m.events);result={prepared:pending.builder.events.length};
     }else if(m.t==='daw-start'){
      if(this.sequence?.active||this.dawPreview||x.waswan_ui_playing())throw Error('Stop Studio/Legacy and release piano preview before starting DAW');
      if(m.projectId!==this.dawProject?.id||m.revision!==this.dawProject?.revision)throw Error('Project changed during playback preparation');
      const countIn=m.countInFrames??0;if(!Number.isSafeInteger(countIn)||countIn<0||countIn>sampleRate*72||countIn&&!m.recordToken)throw Error('Invalid count-in');
      if(m.exportToken&&(countIn||m.recordToken||m.click?.enabled||!Number.isSafeInteger(m.tailFrames)||m.tailFrames<0||m.tailFrames>sampleRate*8))throw Error('Invalid export playback');
      if(m.recordToken!==undefined&&(typeof m.recordToken!=='string'||!/^[\w-]{1,80}$/.test(m.recordToken)))throw Error('Invalid recording token');
      const click=m.click;if(click&&(!Number.isFinite(click.bpm)||click.bpm<40||click.bpm>240||!Array.isArray(click.meter)||!Number.isInteger(click.meter[0])||click.meter[0]<1||click.meter[0]>12||![4,8].includes(click.meter[1])||typeof click.enabled!=='boolean'||!Number.isFinite(click.level)||click.level<0||click.level>1))throw Error('Invalid metronome');
      if(!Number.isSafeInteger(m.startFrame)||m.startFrame<currentFrame+128+countIn||m.startFrame>currentFrame+sampleRate*2+countIn)throw Error('Playback preparation missed its start time; try Play again');
      const pending=this.dawPending;if(!pending||pending.planId!==m.planId||pending.builder.events.length!==pending.count)throw Error('Playback plan is incomplete');const prepared=pending.builder.finish();this.dawPending=null;
      this.daw??=new DawClock((part,note,velocity)=>!!this.engine?.ex.waswan_daw_note(part,note,velocity),()=>this.engine?.ex.waswan_daw_stop(0),state=>{audioTransport.playing=state.playing;if(state.startFrame!==undefined)audioTransport.startFrame=state.startFrame;if(!state.playing){if(state.reason!=='ended')audioTransport.exportPlan=null;audioTransport.recording=false;this.engine?.ex.waswan_daw_transport_guard?.(0);}this.port.postMessage({t:'daw-state',projectId:this.dawProject?.id,planId:this.dawPlanId,...state});},x.waswan_daw_capacity(),(part,bend,mod)=>!!this.engine?.ex.waswan_daw_expression(part,bend,mod));
      this.dawPlanId=m.planId;this.daw.startPrepared(prepared,m.startFrame);Object.assign(audioTransport,{...prepared,events:undefined,initial:undefined,repeated:undefined,planId:m.planId,startFrame:m.startFrame,playing:true,countInFrames:countIn,click,recording:!!m.recordToken,recordToken:m.recordToken,exportPlan:m.exportToken?m.planId:null,exportEnd:m.startFrame+prepared.length-prepared.fromFrame+(m.tailFrames||0)});x.waswan_daw_transport_guard(1);result={startFrame:m.startFrame};
     }else if(m.t==='daw-click'){
      if(typeof m.enabled!=='boolean'||m.level!==undefined&&(!Number.isFinite(m.level)||m.level<0||m.level>1))throw Error('Invalid metronome setting');
      if(audioTransport.playing&&audioTransport.click){
       audioTransport.click.enabled=m.enabled;
       if(m.level!==undefined)audioTransport.click.level=m.level;
      }
      result={enabled:m.enabled};
     }else if(m.t==='daw-stop'){this.dawPreview=null;audioTransport.previewSession=null;this.daw?.stop();this.dawPending=null;audioTransport.playing=false;audioTransport.recording=false;audioTransport.planId=null;audioTransport.exportPlan=null;x.waswan_daw_transport_guard(0);x.waswan_daw_stop(m.hard?1:0);result={stopped:true,frame:currentFrame};}
     else throw Error('Unknown DAW command');
     this.port.postMessage({t:'daw-reply',request:m.request,ok:true,result});
    }catch(error){if(['daw-plan-begin','daw-plan-append','daw-start'].includes(m.t))this.dawPending=null;this.port.postMessage({t:'daw-reply',request:m.request,ok:false,error:error.message});}
    return;
   }
   // The same voice pool is reserved for playback until capture finishes.
   if(this.dawExport&&m.t!=='dsp-control')return;
   if((this.daw?.active||this.dawLiveSession||this.dawPreview)&&m.t==='btn'&&[16,17].includes(m.b)){if(m.down)this.port.postMessage({t:'daw-notice',message:'Stop DAW and disable its inputs before using the Legacy transport'});return;}
   if(m.t==='studio-sequence-start'){
    try{
     if(this.daw?.active||this.dawLiveSession||this.dawPreview)throw Error('Stop DAW and disable its inputs before starting Studio');
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
    try{if(this.sequence?.active||this.daw?.active||this.dawLiveSession||this.dawPreview)throw Error('Stop DAW, disable its inputs and stop Studio MIDI before applying tones');this.engine.restoreStudioContext(m.context,m.token);this.port.postMessage({t:'studio-context-applied',request:m.request,ok:true});}
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
    if(m.t==='reboot'){this.sequence?.stop('instrument-reboot');this.daw?.stop('instrument-reboot');this.dawProject=null;this.dawObserved=null;this.dawPending=null;this.dawLiveSession=null;this.dawPreview=null;audioTransport.previewSession=null;audioTransport.playing=false;audioTransport.recording=false;audioTransport.planId=null;audioTransport.liveSession=null;if(this.session)this.publish(true,'reboot');}
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
  if(this.dawExport){this.lastStore=currentTime;this.lastFrame=currentTime;}
  const result=super.process(inputs,outputs);
  if(!this.engine&&this.daw?.active)this.daw.stop('engine-error');
  if(this.engine&&this.dawProject&&!this.dawExport){
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
    const live=outputs[p+9]?.[c],livePointer=this.dawOutputs==='owned'?x.waswan_daw_live_output?.(p,c):0;
    if(live&&livePointer)live.set(new Float32Array(x.memory.buffer,livePointer,live.length));
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
