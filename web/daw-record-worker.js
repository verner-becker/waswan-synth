// SPDX-License-Identifier: GPL-3.0-only
import {RATE,wavHeader,pcm16} from './studio-format.js';
let meta,dir,audio,journal,metadata,metadataB,port,frames=0,sequence=0,nextFrame=null,eventBytes=0,events=0,finished=false,lastCheckpoint=0,generation=0;
const encoder=new TextEncoder(),pcm=new Int16Array(8192);
const write=(handle,bytes,at)=>{if(handle.write(bytes,{at})!==bytes.byteLength)throw Error('Incomplete take storage write');};
function checkpoint(){if(audio){write(audio,new Uint8Array(wavHeader(frames)),0);audio.flush();}journal.flush();const bytes=encoder.encode(JSON.stringify({...meta,generation:++generation,frames,eventBytes,events})),target=generation%2?metadata:metadataB;write(target,bytes,0);target.truncate(bytes.length);target.flush();lastCheckpoint=performance.now();}
function close(){for(const h of [audio,journal,metadata,metadataB])try{h?.close();}catch{}port?.close();}
function fail(error){if(finished)return;finished=true;if(meta){meta.status='incomplete';meta.reason=error.message;try{checkpoint();}catch{}}close();postMessage({t:'error',message:error.message});}
function end(reason,endFrame){if(finished)return;meta.status=['user','duration-limit','arrangement-end'].includes(reason)?'complete':'incomplete';meta.reason=reason;meta.endFrame=endFrame??meta.firstFrame+frames;checkpoint();finished=true;close();postMessage({t:'finished',meta:{...meta,frames,eventBytes,events}});}
async function init(m){
  meta=m.meta;const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('waswan-daw-takes-v1');dir=await root.getDirectoryHandle(meta.id);
  metadata=await(await dir.getFileHandle('take-a.json',{create:true})).createSyncAccessHandle();metadataB=await(await dir.getFileHandle('take-b.json',{create:true})).createSyncAccessHandle();journal=await(await dir.getFileHandle('events.jsonl',{create:true})).createSyncAccessHandle();
  if(meta.kind==='audio'){audio=await(await dir.getFileHandle('audio.wav',{create:true})).createSyncAccessHandle();write(audio,new Uint8Array(wavHeader(0)),0);port=m.port;port.onmessage=({data:d})=>{try{if(finished)return;if(d.t==='started'){meta.firstFrame=d.frame;meta.startFrame??=d.frame;checkpoint();postMessage({t:'started',frame:d.frame});}else if(d.t==='chunk'){if(d.seq!==sequence++||nextFrame!==null&&nextFrame!==d.frame||!Number.isSafeInteger(d.frames)||d.frames<1||d.frames>4096||frames+d.frames>meta.limit)throw Error('Discontinuous or oversized audio take');nextFrame=d.frame+d.frames;const samples=new Float32Array(d.buffer,0,d.frames*2);pcm16(samples,pcm);const bytes=new Uint8Array(d.frames*4),view=new DataView(bytes.buffer);for(let i=0;i<samples.length;i++)view.setInt16(i*2,pcm[i],true);write(audio,bytes,44+frames*4);frames+=d.frames;port.postMessage({t:'buffer',buffer:d.buffer},[d.buffer]);if(performance.now()-lastCheckpoint>=1000){checkpoint();postMessage({t:'progress',frames});}}else if(d.t==='ended'){if(d.frames!==frames)throw Error('Final audio frame count mismatch');end(d.reason);}}catch(error){fail(error);}};port.start();for(let i=0;i<8;i++){const buffer=new ArrayBuffer(4096*8);port.postMessage({t:'buffer',buffer},[buffer]);}}
  checkpoint();postMessage({t:'ready'});
}
onmessage=({data:m})=>{try{
  if(m.t==='init'){void init(m).catch(fail);return;}if(finished)return;
  if(m.t==='timeline'){Object.assign(meta,m.data);checkpoint();postMessage({t:'timeline-ready'});}
  else if(m.t==='input'){if(events>=131072)throw Error('MIDI journal event budget exceeded');const bytes=encoder.encode(JSON.stringify(m.event)+'\n');if(eventBytes+bytes.length>12*1024*1024)throw Error('MIDI journal byte budget exceeded');write(journal,bytes,eventBytes);eventBytes+=bytes.length;events++;meta.lastFrame=m.event.frame;}
  else if(m.t==='progress'){meta.lastFrame=m.frame;if(performance.now()-lastCheckpoint>=1000)checkpoint();}
  else if(m.t==='finish')end(m.reason,m.endFrame);
}catch(error){fail(error);}};
