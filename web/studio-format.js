// SPDX-License-Identifier: GPL-3.0-only
// Data-only Studio formats. No browser, audio device, or executable project content.
import {validateSequence} from './studio-sequence.js';
export const RATE=44100,MAX_FRAMES=RATE*20*60,MAX_EVENTS=100000,MAX_JSON=16*1024*1024;
export const MAGIC='WASWAN-STUDIO-1\n';
export const COMMANDS=new Set(['midi','key','pad','btn','enc','fader','wheel','velocity','master','panic','drum-hit','drums','analog','ui-control','enc-fine','enc-fine-absolute','voice-mode','voice-unison','voice-sustain','program-select','editor-set','editor-save','studio-note','studio-mixer']);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function wavHeader(frames) {
  if(!integer(frames,0,MAX_FRAMES))throw Error('Invalid audio length');
  const buffer=new ArrayBuffer(44),v=new DataView(buffer),text=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
  text(0,'RIFF');v.setUint32(4,36+frames*4,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,RATE,true);v.setUint32(28,RATE*4,true);
  v.setUint16(32,4,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,frames*4,true);return buffer;
}
export function pcm16(samples,target=new Int16Array(samples.length)) {
  for(let i=0;i<samples.length;i++){
    if(!Number.isFinite(samples[i]))throw Error('Non-finite audio sample');
    const value=Math.max(-1,Math.min(1,samples[i]));target[i]=Math.round(value*(value<0?32768:32767));
  }
  return target;
}
export function validateContext(c) {
  if(!c||c.version!==1||!Array.isArray(c.parts)||c.parts.length!==4||typeof c.session!=='string'||![240300,415064,458752].includes(c.session.length)||!/^[A-Za-z0-9+/]*={0,2}$/.test(c.session)||!integer(c.master,0,1023)||!integer(c.tempo,40,240))throw Error('Invalid instrument context');
  for(const p of c.parts)if(!p||!integer(p.program,1,99)||![0,2].includes(p.engine)||!Array.isArray(p.parameters)||p.parameters.length!==63||!p.parameters.every(v=>integer(v,0,255)))throw Error('Invalid part context');
  for(const p of c.parts)if(p.patch!==undefined&&(!Array.isArray(p.patch)||p.patch.length!==80||!p.patch.every(v=>integer(v,0,255))||!p.parameters.every((v,i)=>v===p.patch[i])))throw Error('Invalid full tone snapshot');
  if(c.mixer!==undefined){
    if(!Array.isArray(c.mixer)||c.mixer.length!==4)throw Error('Invalid saved mixer');
    for(const part of c.mixer)if(!Array.isArray(part)||part.length!==8||!part.every((v,f)=>integer(v,f===1?-64:0,f===1?64:f>=6?1:127)))throw Error('Invalid saved mixer values');
  }
  if(c.selectedPart!==undefined&&!integer(c.selectedPart,0,3))throw Error('Invalid selected part');
  return c;
}
export function validateProject(p) {
  if(!p||p.format!=='waswan-studio-project'||p.version!==1||!integer(p.frames,0,MAX_FRAMES)||p.sampleRate!==RATE||p.channels!==2||!['complete','incomplete'].includes(p.status)||typeof p.name!=='string'||p.name.length>120||!Array.isArray(p.events)||p.events.length>MAX_EVENTS)throw Error('Invalid Studio project');
  if(p.sequence)validateSequence(p.sequence);else if(!p.frames)throw Error('Empty project requires a MIDI sequence');
  validateContext(p.context);
  if(p.sequenceContext)validateContext(p.sequenceContext);
  for(const e of p.events){
    if(!e||!integer(e.frame,0,p.frames)||!['input','command'].includes(e.kind))throw Error('Invalid event time or kind');
    if(e.kind==='input'){
      if(!Array.isArray(e.data)||e.data.length!==3||!e.data.every(v=>integer(v,0,255))||e.data[0]<128||e.data[0]>=240||e.data[1]>127||e.data[2]>127)throw Error('Invalid MIDI input');
    }else if(!e.command||!COMMANDS.has(e.command.t))throw Error('Unsupported instrument command');
    // Strict primitive payloads: no paths, executable data, nested graphs or prototype keys.
    const payload=e.kind==='command'?e.command:e;
    for(const [key,value] of Object.entries(payload)){
      if(['__proto__','prototype','constructor'].includes(key))throw Error('Unsafe project field');
      if(key==='data'&&e.kind==='input')continue;
      if(!['string','number','boolean'].includes(typeof value)||typeof value==='string'&&value.length>120||typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid event payload');
    }
  }
  return p;
}
export function projectBlob(project,audio) {
  validateProject(project);
  if(audio.size!==44+project.frames*4)throw Error('Audio size does not match project');
  const json=new TextEncoder().encode(JSON.stringify(project));if(json.length>MAX_JSON)throw Error('Project event limit exceeded');
  const length=new ArrayBuffer(4);new DataView(length).setUint32(0,json.length,true);
  return new Blob([MAGIC,length,json,audio],{type:'application/octet-stream'});
}
export async function readProject(file) {
  const prefix=MAGIC.length+4;
  if(file.size<prefix+44||file.size>MAX_JSON+MAX_FRAMES*4+prefix+44)throw Error('Project file size exceeds limits');
  const header=await file.slice(0,prefix).arrayBuffer();
  if(new TextDecoder().decode(header.slice(0,MAGIC.length))!==MAGIC)throw Error('Unsupported Studio project format');
  const length=new DataView(header).getUint32(MAGIC.length,true);
  if(!length||length>MAX_JSON||prefix+length+44>file.size)throw Error('Invalid project metadata length');
  const p=validateProject(JSON.parse(await file.slice(prefix,prefix+length).text()));
  const audio=file.slice(prefix+length,file.size,'audio/wav');
  if(audio.size!==44+p.frames*4)throw Error('Truncated or oversized project audio');
  const expected=new Uint8Array(wavHeader(p.frames)),actual=new Uint8Array(await audio.slice(0,44).arrayBuffer());
  if(!actual.every((v,i)=>v===expected[i]))throw Error('Invalid project WAV header');
  return {project:p,audio};
}
