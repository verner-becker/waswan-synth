// SPDX-License-Identifier: GPL-3.0-only
import {inspectWav,mixAudio} from './studio-audio.js';
import {wavHeader} from './studio-format.js';
onmessage=async({data:m})=>{try{
  if(m.t==='import'){
    const info=await inspectWav(m.file),data=new DataView(await m.file.slice(info.offset,info.offset+info.bytes).arrayBuffer()),pcm=new ArrayBuffer(info.frames*4),out=new DataView(pcm);
    const peaks=new Float32Array(256);
    for(let i=0;i<info.frames;i++){const l=data.getInt16(i*info.channels*2,true),r=info.channels===2?data.getInt16(i*4+2,true):l;out.setInt16(i*4,l,true);out.setInt16(i*4+2,r,true);const bin=Math.min(255,Math.floor(i/info.frames*256));peaks[bin]=Math.max(peaks[bin],Math.abs(l)/32768,Math.abs(r)/32768);}
    const audio=new Blob([wavHeader(info.frames),pcm],{type:'audio/wav'});postMessage({t:'imported',frames:info.frames,audio,peaks});
  }else if(m.t==='mix'){
    const assets=[];for(const a of m.assets)assets.push({meta:a.meta,pcm:await a.audio.slice(44).arrayBuffer()});
    const result=mixAudio(m.sequence,assets);postMessage({t:'mixed',...result},[result.left.buffer,result.right.buffer]);
  }
}catch(error){postMessage({t:'error',message:error.message});}};
