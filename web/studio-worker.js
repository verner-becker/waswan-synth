// SPDX-License-Identifier: GPL-3.0-only
import {RATE,MAX_FRAMES,MAX_EVENTS,MAX_JSON,wavHeader,pcm16,validateContext} from './studio-format.js';
let port,eventPort,dir,audio,log,metadata,first=null,frames=0,sequence=0,eventCount=0,eventBytes=0,nextFrame=null,lastProgress=0,finished=false,pendingStop;
const encoder=new TextEncoder(),pcm=new Int16Array(8192);
function write(handle,bytes,at){if(handle.write(bytes,{at})!==bytes.byteLength)throw Error('Incomplete storage write');}
function saveMetadata(){
  const text=encoder.encode(JSON.stringify({...metadata,frames,eventCount})),handle=metadataHandle;
  write(handle,text,0);handle.truncate(text.byteLength);handle.flush();
}
let metadataHandle;
function event(e){
  if(first===null||finished)return;
  if(eventCount>=MAX_EVENTS){port.postMessage({t:'stop',reason:'event-limit'});return;}
  const relative=Math.round(e.frame-first);if(relative<0||relative>MAX_FRAMES)return;
  const line=encoder.encode(JSON.stringify({...e,frame:relative})+'\n');
  if(eventBytes+line.length>MAX_JSON-4*1024*1024){port.postMessage({t:'stop',reason:'event-limit'});return;}
  write(log,line,eventBytes);eventBytes+=line.length;eventCount++;
}
function checkpoint(){write(audio,new Uint8Array(wavHeader(frames)),0);audio.flush();log.flush();saveMetadata();}
function fail(error){
  if(finished)return;finished=true;
  try{port?.postMessage({t:'stop',reason:'storage-error'});}catch{}
  metadata.status='incomplete';metadata.reason='storage-error';
  try{checkpoint();}catch{}
  for(const handle of [audio,log,metadataHandle])try{handle?.close();}catch{}
  eventPort?.close();postMessage({t:'error',id:metadata.id,message:error.message});
}
async function init(m){
  validateContext(m.context);
  const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('waswan-studio-v1',{create:true});
  const id='take-'+Date.now()+'-'+crypto.randomUUID();dir=await root.getDirectoryHandle(id,{create:true});
  metadata={format:'waswan-studio-project',version:1,id,name:'Take '+new Date().toLocaleString(),createdAt:new Date().toISOString(),status:'recording',sampleRate:RATE,channels:2,context:m.context};
  audio=await(await dir.getFileHandle('audio.wav',{create:true})).createSyncAccessHandle();
  log=await(await dir.getFileHandle('events.jsonl',{create:true})).createSyncAccessHandle();
  metadataHandle=await(await dir.getFileHandle('take.json',{create:true})).createSyncAccessHandle();
  write(audio,new Uint8Array(wavHeader(0)),0);saveMetadata();
  port=m.port;eventPort=m.eventPort;
  eventPort.onmessage=({data:e})=>{try{if(e.t==='command')event({kind:'command',frame:e.frame,command:e.command});if(e.t==='parameter')event({kind:'parameter',frame:e.frame,target:e.target,value:e.value});}catch(error){fail(error);}};
  port.onmessage=({data:d})=>{try{
    if(finished)return;
    if(d.t==='started'){first=d.frame;metadata.firstFrame=first;saveMetadata();postMessage({t:'started',id,first});}
    if(d.t==='chunk'){
      if(d.seq!==sequence++||(nextFrame!==null&&nextFrame!==d.frame))throw Error('Audio block discontinuity');
      nextFrame=d.frame+d.frames;
      if(!Number.isSafeInteger(d.frames)||d.frames<1||d.frames>4096||frames+d.frames>MAX_FRAMES)throw Error('Invalid audio block');
      const values=new Float32Array(d.buffer,0,d.frames*2);pcm16(values,pcm);
      // Explicit little endian PCM, independent of the machine's native byte order.
      const bytes=new Uint8Array(d.frames*4),view=new DataView(bytes.buffer);
      for(let i=0;i<values.length;i++)view.setInt16(i*2,pcm[i],true);
      write(audio,bytes,44+frames*4);frames+=d.frames;
      port.postMessage({t:'buffer',buffer:d.buffer},[d.buffer]);
      if(frames-lastProgress>=RATE){checkpoint();lastProgress=frames;postMessage({t:'progress',frames,eventCount});}
    }
    if(d.t==='ended'){
      if(d.frames!==frames)throw Error('Audio frame count mismatch');
      metadata.status=['user','duration-limit','arrangement-end'].includes(d.reason)?'complete':'incomplete';metadata.reason=d.reason;
      checkpoint();finished=true;for(const handle of [audio,log,metadataHandle])handle.close();eventPort.close();
      postMessage({t:'finished',id,frames,eventCount,status:metadata.status,reason:d.reason});
    }
  }catch(error){fail(error);}};
  for(let i=0;i<8;i++){const buffer=new ArrayBuffer(4096*8);port.postMessage({t:'buffer',buffer},[buffer]);}
  port.postMessage({t:'start'});
  if(pendingStop)port.postMessage({t:'stop',reason:pendingStop});
}
onmessage=({data:m})=>{
  if(m.t==='init')void init(m).catch(error=>{if(!metadata)metadata={};fail(error);});
  else if(m.t==='stop'){
    pendingStop=m.reason||'user';port?.postMessage({t:'stop',reason:pendingStop});
    setTimeout(()=>{if(!finished)fail(Error('Capture did not acknowledge stop'));},2000);
  }
  else if(m.t==='stop-at')port?.postMessage({t:'stop-at',frame:m.frame,reason:m.reason});
  else if(m.t==='input')try{event({kind:'input',frame:m.frame,data:m.data,receivedFrame:m.receivedFrame,listening:!!m.listening});}catch(error){fail(error);}
};
