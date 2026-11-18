// SPDX-License-Identifier: GPL-3.0-only
import {RATE,PPQ,LIMITS,emptyProject,makeTrack,validateProject,uuid} from './daw-project.js';
import {readProject as readStudio,wavHeader} from './studio-format.js';
export const MAGIC='WASWAN-DAW-3\n';
const MAX_FILE=LIMITS.json+LIMITS.totalFrames*4+LIMITS.assets*44+MAGIC.length+4;
const immutableChecksums=new WeakMap();
const table=Uint32Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=(i&1)?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
// CRC detects accidental corruption; it is not a signature or authentication.
async function inspect(blob,copy=false){
  if(!copy&&immutableChecksums.has(blob))return {crc:immutableChecksums.get(blob),blob};
  if(copy){
    // Bound the temporary copy by one source, never the entire project file.
    const bytes=new Uint8Array(await blob.arrayBuffer());let crc=0xffffffff;
    for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);
    const copied=new Blob([bytes],{type:'audio/wav'}),tail=new Uint8Array(await copied.slice(-64).arrayBuffer());
    if(!tail.every((v,i)=>v===bytes[bytes.length-tail.length+i]))throw Error('Imported audio copy is incomplete');
    const checksum=(crc^0xffffffff)>>>0;immutableChecksums.set(copied,checksum);return {crc:checksum,blob:copied};
  }
  let crc=0xffffffff;const reader=blob.stream().getReader();
  try{while(true){const {done,value}=await reader.read();if(done)break;for(const b of value)crc=table[(crc^b)&255]^(crc>>>8);}}finally{reader.releaseLock();}
  const checksum=(crc^0xffffffff)>>>0;
  if(typeof File==='undefined'||!(blob instanceof File))immutableChecksums.set(blob,checksum);
  return {crc:checksum,blob};
}
export const sourceChecksum=async blob=>(await inspect(blob)).crc;
export async function archiveHeader(file){
  const prefix=MAGIC.length+4;
  if(file.size<prefix||await file.slice(0,MAGIC.length).text()!==MAGIC)throw Error('Invalid archive signature');
  const n=new DataView(await file.slice(MAGIC.length,prefix).arrayBuffer()).getUint32(0,true);
  if(n<1||n>LIMITS.json||prefix+n>file.size)throw Error('Invalid project metadata length');
  const envelope=JSON.parse(await file.slice(prefix,prefix+n).text()),p=validateProject(envelope.project);
  if(!Array.isArray(envelope.checksums)||envelope.checksums.length!==p.assets.length)throw Error('Invalid source integrity table');
  for(let i=0;i<p.assets.length;i++){const check=envelope.checksums[i],meta=p.assets[i];if(check?.id!==meta.id||check.bytes!==meta.bytes||!Number.isSafeInteger(check.crc32)||check.crc32<0||check.crc32>0xffffffff)throw Error('Invalid source integrity table');}
  return {envelope,header:file.slice(0,prefix+n)};
}
async function canonical(blob,meta){
  if(!(blob instanceof Blob)||blob.size!==meta.bytes)throw Error('Missing audio source');
  const actual=new Uint8Array(await blob.slice(0,44).arrayBuffer()),expected=new Uint8Array(wavHeader(meta.frames));
  if(actual.length!==44||!actual.every((v,i)=>v===expected[i]))throw Error('Invalid canonical audio source');
}
export async function projectBlob(project,assets){
  validateProject(project);const sources=[],checksums=[];
  for(const meta of project.assets){const source=assets.get(meta.id);await canonical(source,meta);checksums.push({id:meta.id,bytes:meta.bytes,crc32:(await inspect(source)).crc});sources.push(source);}
  const json=new TextEncoder().encode(JSON.stringify({writeId:uuid(),project,checksums}));if(json.length>LIMITS.json)throw Error('Project metadata exceeds 16 MiB');
  const size=new ArrayBuffer(4);new DataView(size).setUint32(0,json.length,true);
  return new Blob([MAGIC,size,json,...sources],{type:'application/octet-stream'});
}
export async function readProject(file,{copyAssets=true,assetStore}={}){
  if(!(file instanceof Blob)||file.size<20||file.size>MAX_FILE)throw Error('Project file exceeds supported limits');
  if(await file.slice(0,MAGIC.length).text()!==MAGIC)return migrateStudio(await readStudio(file),assetStore);
  const {envelope,header}=await archiveHeader(file),p=envelope.project;
  let at=header.size;const assets=new Map();
  for(let i=0;i<p.assets.length;i++){
    const meta=p.assets[i],check=envelope.checksums[i];
    if(check?.id!==meta.id||check.bytes!==meta.bytes||!Number.isSafeInteger(check.crc32)||check.crc32<0||check.crc32>0xffffffff||at+meta.bytes>file.size)throw Error('Invalid or truncated source table');
    const source=file.slice(at,at+meta.bytes,'audio/wav');await canonical(source,meta);
    // Materialize immutable source bytes: future Save must not depend on a File
    // snapshot that can become unreadable when that same user file is replaced.
    const copied=await inspect(source,copyAssets&&!assetStore);if(copied.crc!==check.crc32)throw Error('Audio source checksum mismatch');
    let stable=copied.blob;
    if(assetStore){stable=await assetStore.copy(source);if(stable.size!==meta.bytes||(await inspect(stable)).crc!==check.crc32)throw Error('Imported audio copy is incomplete');immutableChecksums.set(stable,check.crc32);}
    assets.set(meta.id,stable);at+=meta.bytes;
  }
  if(at!==file.size)throw Error('Unexpected project data');
  return {project:p,assets,warnings:[],dispose:assetStore?()=>assetStore.dispose():async()=>{}};
}
export async function fileToken(file){
  if(await file.slice(0,MAGIC.length).text()===MAGIC){
    const prefix=MAGIC.length+4;if(file.size<prefix)throw Error('Truncated project');
    const n=new DataView(await file.slice(MAGIC.length,prefix).arrayBuffer()).getUint32(0,true);
    if(n<1||n>LIMITS.json||prefix+n>file.size)throw Error('Invalid project metadata');
    const envelope=JSON.parse(await file.slice(prefix,prefix+n).text());
    if(typeof envelope.writeId==='string'&&/^[\w-]{1,80}$/.test(envelope.writeId))return envelope.writeId+':'+file.size+':'+(await inspect(file.slice(prefix,prefix+n))).crc;
  }
  return file.size+':'+(await inspect(file)).crc;
}
export async function migrateStudio(take,assetStore){
  const old=take.project,s=old.sequence,p=emptyProject(),assets=new Map(),parts=[];
  p.name=old.name||'Imported Studio project';p.bpm=s?.bpm||120;p.meter=s?.meter||[4,4];p.length=s?.length||Math.max(PPQ*16,Math.ceil(old.frames/RATE*p.bpm*PPQ/60));
  const context=old.sequenceContext||old.context;
  for(let part=0;part<4;part++){
    const t=makeTrack('midi','Part '+'ABCD'[part]);t.id='studio-part-'+part;
    const state=context.parts[part],mix=s?.tracks?.[part];
    if(state.patch)t.instrument={type:state.engine===2?'drumx':'analog',patch:[...state.patch]};
    if(mix){t.volume=(mix.level/100)**2;t.pan=mix.pan/64;t.mute=mix.mute;t.solo=mix.solo;}
    parts.push(t);p.tracks.push(t);
    const groups=(s?.clips||[]).filter(c=>c.part===part).map(c=>({id:c.id,name:c.name,start:c.start,length:c.length,notes:s.notes.filter(n=>n.clip===c.id)}));
    const ungrouped=(s?.notes||[]).filter(n=>n.part===part&&!n.clip);if(ungrouped.length)groups.push({id:uuid(),name:'Studio notes',start:0,length:s.length,notes:ungrouped});
    for(const group of groups)p.clips.push({id:uuid(),type:'midi',trackId:t.id,name:group.name||'Studio clip',position:{unit:'ticks',value:group.start},length:group.length,loopLength:group.length,loop:false,notes:group.notes.map(n=>({id:uuid(),pitch:n.note,velocity:n.velocity,start:n.start-group.start,duration:n.duration}))});
  }
  const add=async(meta,blob)=>{const a={...meta,name:meta.name||'Studio source',sampleRate:RATE,channels:2};await canonical(blob,a);p.assets.push(a);const original=await inspect(blob,!assetStore),stable=assetStore?await assetStore.copy(blob):original.blob;if(assetStore&&(await inspect(stable)).crc!==original.crc)throw Error('Migrated audio copy is incomplete');immutableChecksums.set(stable,original.crc);assets.set(a.id,stable);return a;};
  const assetIds=new Map();for(const a of take.assets||[]){const newId=uuid();assetIds.set(a.meta.id,newId);await add({...a.meta,id:newId},a.audio);}
  let audioTrack;
  if(s?.audioClips?.length){audioTrack=makeTrack('audio','Studio audio');p.tracks.push(audioTrack);}
  for(const c of s?.audioClips||[])p.clips.push({id:uuid(),type:'audio',trackId:audioTrack.id,name:'Studio audio clip',assetId:assetIds.get(c.asset),position:{unit:'ticks',value:c.start},offset:c.offset,frames:c.frames,gain:c.mute?0:c.gain,pan:c.pan,fadeIn:0,fadeOut:0});
  let reference;
  if(old.frames){reference=await add({id:uuid(),name:'Original recorded take',frames:old.frames,bytes:take.audio.size},take.audio);
    if(!s){audioTrack=makeTrack('audio','Recorded take');p.tracks.push(audioTrack);p.clips.push({id:uuid(),type:'audio',trackId:audioTrack.id,name:'Recorded take',assetId:reference.id,position:{unit:'seconds',value:0},offset:0,frames:old.frames,gain:1,pan:0,fadeIn:0,fadeOut:0});}
  }
  for(const lane of s?.automation||[]){
    const match=/^part:([0-3]):(level|pan)$/.exec(lane.target);if(!match)continue;
    p.automation.push({id:uuid(),trackId:parts[Number(match[1])].id,target:match[2]==='pan'?'pan':'volume',enabled:lane.enabled,curve:lane.curve,points:lane.points.map(point=>({tick:point.tick,value:match[2]==='pan'?point.value/64:(point.value/100)**2}))});
  }
  // Preserve every original event/context, including expression and FX whose
  // independent DAW playback is not yet implemented. Never silently discard it.
  p.legacy={studio:old,takeAssetId:reference?.id||null};validateProject(p);
  return {project:p,assets,dispose:assetStore?()=>assetStore.dispose():async()=>{},warnings:['Studio source data retained. Shared Legacy FX and expression require the DAW playback adapter; verify sound before replacing the original file.']};
}
