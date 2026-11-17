// SPDX-License-Identifier: GPL-3.0-only
import {RATE} from './studio-format.js';
import {PPQ} from './studio-sequence.js';
export const AUTOMATION_TARGETS=[];
for(let part=0;part<4;part++){
  for(const [key,name,parameter] of [['cutoff','Cutoff',12],['resonance','Resonance',13],['filter-env','Filter envelope',14],['release','Amp release',27]])AUTOMATION_TARGETS.push({id:`part:${part}:${key}`,name:`Part ${'ABCD'[part]} · ${name}`,kind:'param',part,parameter,min:0,max:127});
  for(const [key,name,field,min,max] of [['level','Volume',0,0,127],['pan','Pan',1,-64,64],['chorus-send','Chorus send',2,0,127],['delay-send','Delay send',3,0,127],['reverb-send','Reverb send',4,0,127]])AUTOMATION_TARGETS.push({id:`part:${part}:${key}`,name:`Part ${'ABCD'[part]} · ${name}`,kind:'mix',part,field,min,max});
}
AUTOMATION_TARGETS.push({id:'master',name:'Master · shared',kind:'master',min:0,max:1023},
  {id:'midi-pitch-bend',name:'MIDI pitch bend · shared',kind:'expression',field:0,min:-8192,max:8191},
  {id:'modulation',name:'Modulation · selected live part',kind:'expression',field:1,min:0,max:127},
  {id:'wheel-pitch-bend',name:'Pitch wheel · selected live part',kind:'expression',field:2,min:-8192,max:8191},
  {id:'sequence-sustain',name:'Sustain · Studio notes only',kind:'pedal',min:0,max:127});
export const automationTarget=id=>AUTOMATION_TARGETS.find(t=>t.id===id);
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function validateAutomation(lanes,length){
  if(lanes===undefined)return;
  if(!Array.isArray(lanes)||lanes.length>16)throw Error('Automation limit: 16 lanes');
  const ids=new Set(),targets=new Set();
  for(const lane of lanes){
    const target=automationTarget(lane?.target);
    if(!lane||typeof lane.id!=='string'||lane.id.length>80||ids.has(lane.id)||!target||targets.has(lane.target)||typeof lane.enabled!=='boolean'||!['linear','step'].includes(lane.curve)||!Array.isArray(lane.points)||!lane.points.length||lane.points.length>2048)throw Error('Invalid automation lane');
    if(target.kind==='pedal'&&lane.curve!=='step')throw Error('Sustain automation uses steps');
    let previous=-1;for(const p of lane.points){if(!p||!int(p.tick,0,length)||p.tick<=previous||!int(p.value,target.min,target.max))throw Error('Invalid automation point');previous=p.tick;}
    ids.add(lane.id);targets.add(lane.target);
  }
}
export function automationValue(lane,tick){
  const points=lane.points;let low=0,high=points.length;
  while(low<high){const mid=(low+high)>>>1;if(points[mid].tick<=tick)low=mid+1;else high=mid;}
  const i=Math.max(0,low-1),a=points[i],b=points[i+1];
  if(!b||tick<a.tick||lane.curve==='step')return a.value;
  return Math.round(a.value+(b.value-a.value)*(tick-a.tick)/(b.tick-a.tick));
}
export function initialAutomation(context,target){
  if(target.kind==='param')return context.parts[target.part].parameters[target.parameter];
  if(target.kind==='mix')return context.mixer?.[target.part]?.[target.field]??(target.field===0?100:0);
  if(target.kind==='master')return context.master;
  if(target.kind==='expression')return context.expression?.[target.field]??0;
  return context.midiSustain?127:0;
}
export function laneFromTake(project,sequence,targetId){
  const target=automationTarget(targetId);if(!target)throw Error('Unknown automation target');
  const changes=project.events.filter(e=>e.kind==='parameter'&&e.target===targetId).sort((a,b)=>a.frame-b.frame);
  if(!changes.length)throw Error('No applied changes for this control in the take');
  const points=[{tick:0,value:initialAutomation(project.context,target)}];
  const mapped=new Map(points.map(p=>[p.tick,p.value]));
  for(const e of changes){let tick=Math.max(0,Math.round((e.frame+(project.sequenceOffset||0))*sequence.bpm*PPQ/(RATE*60)));if(project.sequenceOffset!==undefined&&sequence.loop)tick%=sequence.length;if(tick>sequence.length)continue;mapped.set(tick,e.value);}
  points.splice(0,points.length,...Array.from(mapped,([tick,value])=>({tick,value})).sort((a,b)=>a.tick-b.tick));
  const lane={id:crypto.randomUUID(),target:targetId,enabled:true,curve:'step',points};validateAutomation([lane],sequence.length);return lane;
}
export function readAutomation(engine,output=Array(AUTOMATION_TARGETS.length)){
  const x=engine.ex;for(let i=0;i<AUTOMATION_TARGETS.length;i++){
    const t=AUTOMATION_TARGETS[i];
    if(t.kind==='param')output[i]=x.sim_engine_patch(t.part)===0?x.sim_param(t.part,t.parameter):null;
    else if(t.kind==='mix')output[i]=x.waswan_studio_mix_value?.(t.part,t.field)??null;
    else if(t.kind==='master')output[i]=x.sim_master_current();
    else if(t.kind==='expression')output[i]=x.waswan_studio_expression_value?.(t.field)??null;
    else output[i]=x.waswan_midi_sustain()?127:0;
  }
  return output;
}
export function applyAutomation(engine,id,value){
  const t=automationTarget(id),x=engine.ex;if(!t||!int(value,t.min,t.max)||x.sim_midi_mode?.())return false;
  if(t.kind==='param')return !!x.waswan_studio_parameter_set?.(t.part,t.parameter,value);
  if(t.kind==='mix')return !!x.waswan_studio_mix_set?.(t.part,t.field,value);
  if(t.kind==='master'){x.sim_master(value);return true;}
  if(t.kind==='expression')return !!x.waswan_studio_expression_set?.(t.field,value);
  return false; // Sustain belongs to the Studio note owner, never the live pedal.
}
