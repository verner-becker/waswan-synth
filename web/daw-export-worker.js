// SPDX-License-Identifier: GPL-3.0-only
import {wavHeader} from './studio-format.js';

const chunkFrames=1024;
let handles=[],port,frames=0,sequence=0,limit,closed=false;
const pcm=new DataView(new ArrayBuffer(chunkFrames*4));
const peaks=[];
const clipped=[];
function write(handle,bytes,at){
  if(handle.write(bytes,{at})!==bytes.byteLength)throw Error('Incomplete export write');
}
function close(){
  closed=true;
  port?.close();
  for(const handle of handles)handle.close();
  handles=[];
}
function fail(error){
  try{close();}finally{postMessage({t:'error',message:error.message});}
}
function capture(m){
  if(closed)return;
  if(m.t==='end'){
    if(m.error||m.frames!==frames||frames!==limit)throw Error(m.error||'Incomplete audio export');
    try{for(const handle of handles)handle.flush();}finally{close();}
    postMessage({t:'finished',frames,peaks,clipped});
    return;
  }
  if(m.t!=='chunk'||m.seq!==sequence++||m.frames<1||m.frames>chunkFrames||frames+m.frames>limit)
    throw Error('Discontinuous export audio');
  const count=handles.length,input=new Float32Array(m.buffer,0,m.frames*count*2);
  const bytes=new Uint8Array(pcm.buffer,0,m.frames*4);
  for(let j=0;j<count;j++){
    for(let i=0;i<m.frames*2;i++){
      const value=input[(i>>1)*count*2+j*2+(i&1)],peak=Math.abs(value);
      peaks[j]=Math.max(peaks[j],peak);
      if(peak>1)clipped[j]++;
      const v=Math.min(1,Math.max(-1,value));
      pcm.setInt16(i*2,Math.min(32767,Math.round(v*32768)),true);
    }
    write(handles[j],bytes,44+frames*4);
  }
  frames+=m.frames;
  port.postMessage(m.buffer,[m.buffer]);
}
onmessage=async({data:m})=>{
  if(m.t==='cancel'){close();postMessage({t:'closed'});return;}
  try{
    limit=m.frames;
    for(let i=0;i<m.count;i++){
      const file=await m.dir.getFileHandle(i+'.wav',{create:true});
      if(closed)return;
      const handle=await file.createSyncAccessHandle();
      if(closed){handle.close();return;}
      handles.push(handle);
      peaks.push(0);
      clipped.push(0);
      write(handle,new Uint8Array(wavHeader(limit)),0);
    }
    port=m.port;
    port.onmessage=({data})=>{try{capture(data);}catch(error){fail(error);}};
    for(let i=0;i<16;i++){
      const buffer=new ArrayBuffer(chunkFrames*m.count*8);
      port.postMessage(buffer,[buffer]);
    }
    postMessage({t:'ready'});
  }catch(error){fail(error);}
};
