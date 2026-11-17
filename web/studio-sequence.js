// SPDX-License-Identifier: GPL-3.0-only
// Musical data and SMF serialization, independent of DOM and physical controls.
import {RATE,MAX_FRAMES} from './studio-format.js';
import {validateAudioClips} from './studio-audio.js';
import {validateAutomation,laneFromTake} from './studio-automation.js';
export const PPQ=960,MAX_NOTES=4096;
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function emptySequence(bpm=120){return {version:1,ppq:PPQ,bpm:Math.max(40,Math.min(240,bpm)),meter:[4,4],length:16*PPQ,loop:false,notes:[]};}
export function validateSequence(s){
  if(!s||s.version!==1||s.ppq!==PPQ||!int(s.bpm,40,240)||!Array.isArray(s.meter)||s.meter.length!==2||!int(s.meter[0],1,12)||![4,8].includes(s.meter[1])||!int(s.length,PPQ/4,PPQ*4096)||typeof s.loop!=='boolean'||!Array.isArray(s.notes)||s.notes.length>MAX_NOTES)throw Error('Invalid MIDI sequence');
  if(Math.ceil(s.length*RATE*60/(s.bpm*PPQ))>MAX_FRAMES)throw Error('Sequence exceeds 20 minutes');
  const ids=new Set();
  for(const n of s.notes){
    if(!n||typeof n.id!=='string'||n.id.length>80||ids.has(n.id)||!int(n.part,0,3)||!int(n.note,0,127)||!int(n.velocity,1,127)||!int(n.start,0,s.length-1)||!int(n.duration,1,s.length-n.start))throw Error('Invalid MIDI note');
    ids.add(n.id);
  }
  if(s.tracks!==undefined){
    if(!Array.isArray(s.tracks)||s.tracks.length!==4)throw Error('Four MIDI tracks are required');
    for(let i=0;i<4;i++){const t=s.tracks[i];if(!t||t.part!==i||!int(t.level,0,127)||!int(t.pan,-64,64)||typeof t.mute!=='boolean'||typeof t.solo!=='boolean')throw Error('Invalid MIDI track');}
  }
  if(s.clips!==undefined){
    if(!Array.isArray(s.clips)||s.clips.length>128)throw Error('Clip limit exceeded');
    const clips=new Map();for(const c of s.clips){
      if(!c||typeof c.id!=='string'||c.id.length>80||clips.has(c.id)||typeof c.name!=='string'||c.name.length>48||!int(c.part,0,3)||!int(c.start,0,s.length-1)||!int(c.length,1,s.length-c.start))throw Error('Invalid MIDI clip');clips.set(c.id,c);
    }
    for(const n of s.notes)if(n.clip!==undefined){const c=clips.get(n.clip);if(!c||c.part!==n.part||n.start<c.start||n.start+n.duration>c.start+c.length)throw Error('Note outside its clip');}
  }else if(s.notes.some(n=>n.clip!==undefined))throw Error('Missing clip definitions');
  if(s.expression!==undefined){
    if(!Array.isArray(s.expression)||s.expression.length>10000)throw Error('MIDI expression limit exceeded');
    for(const e of s.expression)if(!e||!int(e.tick,0,s.length)||!Array.isArray(e.data)||e.data.length!==3||![176,224].includes(e.data[0]&240)||!int(e.data[0],128,239)||!int(e.data[1],0,127)||!int(e.data[2],0,127))throw Error('Invalid MIDI expression');
  }
  if(s.expressionStart){const e=s.expressionStart;if(!int(e.part,0,3)||!int(e.pitch,-8192,8191)||!int(e.modulation,0,127)||!int(e.pedal,0,127))throw Error('Invalid expression start state');}
  validateAudioClips(s.audioClips,s);
  validateAutomation(s.automation,s.length);
  return s;
}
export const tickFrame=(tick,bpm)=>Math.round(tick*RATE*60/(bpm*PPQ));
export function partEnabled(sequence,part){const tracks=sequence.tracks;if(!tracks)return true;return !tracks[part].mute&&(!tracks.some(t=>t.solo)||tracks[part].solo);}
export function musicalPosition(frame,sequence){
  const tick=Math.max(0,Math.floor(frame*sequence.bpm*PPQ/(RATE*60))),beatTicks=PPQ*4/sequence.meter[1],barTicks=beatTicks*sequence.meter[0];
  return [Math.floor(tick/barTicks)+1,Math.floor(tick%barTicks/beatTicks)+1,tick%beatTicks].map((n,i)=>String(n).padStart(i===1?2:3,'0')).join(':');
}
export function inputNotes(project,targetPart=project.context.selectedPart??0){
  if(!int(targetPart,0,3))throw Error('Invalid input destination part');
  const sequence=emptySequence(project.context.tempo),held=new Map();sequence.expression=[];
  sequence.expressionStart={part:targetPart,pitch:project.context.expression?.[0]??0,modulation:project.context.expression?.[1]??0,pedal:project.context.midiSustain?127:0};let id=0,maxTick=PPQ*4;
  const tick=frame=>Math.max(0,Math.round(frame*sequence.bpm*PPQ/(RATE*60)));
  const events=project.events.filter(e=>e.kind==='input'&&e.listening!==false).sort((a,b)=>a.frame-b.frame);
  for(const e of events){
    const [st,note,velocity]=e.data,kind=st&240,key=(st&15)*128+note;
    if(kind===176||kind===224)sequence.expression.push({tick:tick(e.frame),data:[(st&240)|targetPart,note,velocity]});
    if(kind!==128&&kind!==144)continue;
    if(kind===144&&velocity){
      if(sequence.notes.length+held.size>=MAX_NOTES)throw Error('Recorded note limit exceeded');
      const previous=held.get(key);if(previous){previous.duration=Math.max(1,tick(e.frame)-previous.start);sequence.notes.push(previous);}
      held.set(key,{id:'input-'+id++,part:targetPart,note,velocity,start:tick(e.frame),duration:1});
    }else if(held.has(key)){
      const n=held.get(key);n.duration=Math.max(1,tick(e.frame)-n.start);sequence.notes.push(n);held.delete(key);
    }
  }
  for(const n of held.values()){n.duration=Math.max(1,tick(project.frames)-n.start);sequence.notes.push(n);}
  for(const n of sequence.notes)maxTick=Math.max(maxTick,n.start+n.duration);
  for(const e of sequence.expression)maxTick=Math.max(maxTick,e.tick);
  sequence.length=Math.ceil(maxTick/(4*PPQ))*4*PPQ;
  // At the recording duration boundary, avoid padding beyond the supported audio length.
  if(tickFrame(sequence.length,sequence.bpm)>MAX_FRAMES)sequence.length=maxTick;
  for(const target of ['midi-pitch-bend','modulation','wheel-pitch-bend','sequence-sustain'])if(project.events.some(e=>e.kind==='parameter'&&e.target===target))(sequence.automation??=[]).push(laneFromTake(project,sequence,target));
  return validateSequence(sequence);
}
export function compileNotes(sequence){
  validateSequence(sequence);const events=[];
  for(const n of sequence.notes.filter(n=>partEnabled(sequence,n.part))){
    events.push({frame:tickFrame(n.start,sequence.bpm),part:n.part,note:n.note,velocity:n.velocity});
    events.push({frame:tickFrame(n.start+n.duration,sequence.bpm),part:n.part,note:n.note,velocity:0});
  }
  events.sort((a,b)=>a.frame-b.frame||a.velocity-b.velocity||a.part-b.part||a.note-b.note);
  let block=-1,count=0;for(const e of events){const b=Math.floor(e.frame/128);if(b!==block){block=b;count=0;}if(++count>512)throw Error('Too many MIDI events in one audio block');}
  return {events,length:tickFrame(sequence.length,sequence.bpm),duration:sequence.length*RATE*60/(sequence.bpm*PPQ),ticks:sequence.length,
    expression:expressionEvents(sequence).filter(e=>partEnabled(sequence,Math.min(e.data[0]&15,3))).map(e=>({frame:tickFrame(e.tick,sequence.bpm),data:e.data})).sort((a,b)=>a.frame-b.frame),
    automation:(sequence.automation||[]).filter(l=>l.enabled&&(l.target.startsWith('part:')?partEnabled(sequence,Number(l.target.split(':')[1])):true)),loop:sequence.loop,bpm:sequence.bpm,meter:sequence.meter};
}
function expressionEvents(sequence){
  const events=[],e=sequence.expressionStart;
  if(e){const bend=e.pitch+8192;events.push({tick:0,data:[224|e.part,bend&127,bend>>7]},{tick:0,data:[176|e.part,1,e.modulation]},{tick:0,data:[176|e.part,64,e.pedal]});}
  return events.concat(sequence.expression||[]);
}
function variable(value){
  if(!int(value,0,0x0fffffff))throw Error('MIDI delta time exceeds SMF limits');
  const out=[value&127];while((value=Math.floor(value/128)))out.unshift((value&127)|128);return out;
}
const be32=n=>[n>>>24&255,n>>>16&255,n>>>8&255,n&255];
const ascii=s=>Array.from(s,c=>c.charCodeAt(0));
function track(events,endTick){
  events.sort((a,b)=>a.tick-b.tick||a.order-b.order);const data=[];let last=0;
  for(const e of events){data.push(...variable(e.tick-last),...e.data);last=e.tick;}
  data.push(...variable(Math.max(0,endTick-last)),255,47,0);return [...ascii('MTrk'),...be32(data.length),...data];
}
export function smf(sequence){
  validateSequence(sequence);const microseconds=Math.round(60000000/sequence.bpm);
  const tracks=[track([{tick:0,order:0,data:[255,81,3,microseconds>>>16&255,microseconds>>>8&255,microseconds&255]},
    {tick:0,order:1,data:[255,88,4,sequence.meter[0],sequence.meter[1]===8?3:2,24,8]}],sequence.length)];
  for(let part=0;part<4;part++){
    const events=[{tick:0,order:-1,data:[255,3,6,...ascii('Part '+ 'ABCD'[part])]}];
    for(const n of sequence.notes.filter(n=>n.part===part&&partEnabled(sequence,part))){
      events.push({tick:n.start,order:1,data:[144|part,n.note,n.velocity]},{tick:n.start+n.duration,order:0,data:[128|part,n.note,0]});
    }
    for(const e of expressionEvents(sequence))if(Math.min(e.data[0]&15,3)===part&&partEnabled(sequence,part))events.push({tick:e.tick,order:0,data:e.data});
    tracks.push(track(events,sequence.length));
  }
  const length=tracks.reduce((sum,t)=>sum+t.length,14),out=new Uint8Array(length);
  out.set([...ascii('MThd'),0,0,0,6,0,1,0,5,PPQ>>>8,PPQ&255]);let at=14;
  for(const t of tracks){out.set(t,at);at+=t.length;}return out;
}
