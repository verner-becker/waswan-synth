// SPDX-License-Identifier: GPL-3.0-only
import {projectBlob,readProject} from './daw-format.js';
import {ImmutableAudioStore} from './daw-assets.js';
import {wavHeader} from './studio-format.js';
const root=async()=> (await navigator.storage.getDirectory()).getDirectoryHandle('waswan-daw-takes-v1',{create:true});
const safe=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
export async function createTake(meta,controller){
  const base=await root();let release,held;await new Promise((resolve,reject)=>{held=navigator.locks.request('waswan-daw-take-'+meta.id,()=>new Promise(done=>{release=done;resolve();})).catch(reject);});
  try{const dir=await base.getDirectoryHandle(meta.id,{create:true}),file=await dir.getFileHandle('base.wsproj',{create:true}),writer=await file.createWritable();try{await writer.write(await projectBlob(controller.snapshot(),controller.assets));await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}return {dir,release:async()=>{release();await held;}};}catch(error){release();await held;throw error;}
}
async function checkpoint(dir,id){
  const candidates=[];for(const name of ['take-a.json','take-b.json'])try{const meta=JSON.parse(await(await(await dir.getFileHandle(name)).getFile()).text());if(meta.id===id&&meta.version===1&&['audio','midi'].includes(meta.kind)&&Number.isSafeInteger(meta.generation)&&Number.isSafeInteger(meta.eventBytes)&&meta.eventBytes>=0&&meta.eventBytes<=12*1024*1024&&Number.isSafeInteger(meta.frames)&&meta.frames>=0&&meta.frames<=44100*1200)candidates.push(meta);}catch{}
  candidates.sort((a,b)=>b.generation-a.generation);for(const meta of candidates)try{const journal=await(await dir.getFileHandle('events.jsonl')).getFile();if(journal.size<meta.eventBytes)continue;if(meta.kind==='audio'&&(await(await dir.getFileHandle('audio.wav')).getFile()).size<44+meta.frames*4)continue;return meta;}catch{}throw Error('No intact take checkpoint');
}
export async function listTakes(){const found=[];for await(const [id,dir] of (await root()).entries())if(dir.kind==='directory'&&safe(id))await navigator.locks.request('waswan-daw-take-'+id,{ifAvailable:true},async lock=>{if(!lock)return;try{const meta=await checkpoint(dir,id);if(meta.startFrame!==undefined&&(meta.kind==='audio'?meta.frames>0:(meta.endFrame??meta.lastFrame)>meta.startFrame))found.push(meta);}catch{}});return found.sort((a,b)=>b.created-a.created);}
export async function readTake(id,{baseProject=false}={}){
  if(!safe(id))throw Error('Invalid take ID');return navigator.locks.request('waswan-daw-take-'+id,{ifAvailable:true},async lock=>{
    if(!lock)throw Error('Take is still being recorded');const dir=await(await root()).getDirectoryHandle(id),meta=await checkpoint(dir,id);if(meta.id!==id||!['midi','audio'].includes(meta.kind)||!Number.isSafeInteger(meta.startFrame))throw Error('Incomplete take metadata');
    const result={meta};if(meta.kind==='midi'){const file=await(await dir.getFileHandle('events.jsonl')).getFile();if(!Number.isSafeInteger(meta.eventBytes)||meta.eventBytes>12*1024*1024||meta.eventBytes>file.size)throw Error('Incomplete MIDI journal');result.events=(await file.slice(0,meta.eventBytes).text()).split('\n').filter(Boolean).map(line=>JSON.parse(line));}
    else{if(!Number.isSafeInteger(meta.frames)||meta.frames<1||meta.frames>44100*1200)throw Error('Invalid audio take length');const file=await(await dir.getFileHandle('audio.wav')).getFile();if(file.size<44+meta.frames*4)throw Error('Incomplete recorded audio');const expected=new Uint8Array(wavHeader(meta.frames)),actual=new Uint8Array(await file.slice(0,44).arrayBuffer());if(actual.length===44&&actual.every((v,i)=>v===expected[i])&&file.size===44+meta.frames*4)result.audio=file;else{const clean=await dir.getFileHandle('recovered-'+crypto.randomUUID()+'.wav',{create:true}),writer=await clean.createWritable();try{await writer.write(expected);await writer.write(file.slice(44,44+meta.frames*4));await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}result.audio=await clean.getFile();}meta.endFrame=meta.firstFrame+meta.frames;}
    if(baseProject){const store=await ImmutableAudioStore.create();try{result.loaded=await readProject(await(await dir.getFileHandle('base.wsproj')).getFile(),{assetStore:store});}catch(error){await store.dispose();throw error;}}return result;
  });
}
// Only abandoned, empty preparations may be removed here. Committed PCM remains
// referenced by the controller and Undo; successful takes are never auto-deleted.
export async function discardEmptyTake(id){
  if(!safe(id))return;return navigator.locks.request('waswan-daw-take-'+id,{ifAvailable:true},async lock=>{if(!lock)return;const base=await root();let dir;try{dir=await base.getDirectoryHandle(id);}catch{return;}
    let meta;try{meta=await checkpoint(dir,id);}catch{try{if((await(await dir.getFileHandle('audio.wav')).getFile()).size>44)return;}catch{}try{if((await(await dir.getFileHandle('events.jsonl')).getFile()).size)return;}catch{}await base.removeEntry(id,{recursive:true});return;}
    if(meta.frames||meta.eventBytes||meta.startFrame!==undefined&&(meta.endFrame??meta.lastFrame)>meta.startFrame)return;await base.removeEntry(id,{recursive:true});
  });
}
