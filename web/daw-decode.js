// SPDX-License-Identifier: GPL-3.0-only
import {wavHeader} from './studio-format.js';
export async function decodeCanonical(source,frames){
  const bytes=await source.arrayBuffer(),header=new Uint8Array(wavHeader(frames)),actual=new Uint8Array(bytes,0,Math.min(44,bytes.byteLength));
  if(bytes.byteLength!==44+frames*4||actual.length!==44||!header.every((v,i)=>v===actual[i]))throw Error('Invalid canonical audio source');
  const left=new Float32Array(frames),right=new Float32Array(frames),little=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
  if(little){const pcm=new Int16Array(bytes,44);for(let i=0;i<frames;i++){left[i]=pcm[i*2]/32768;right[i]=pcm[i*2+1]/32768;}}
  else{const pcm=new DataView(bytes,44);for(let i=0;i<frames;i++){left[i]=pcm.getInt16(i*4,true)/32768;right[i]=pcm.getInt16(i*4+2,true)/32768;}}
  return {left,right};
}
export async function canonicalPeaks(source,frames,bins=2048){
  const bytes=await source.arrayBuffer(),header=new Uint8Array(wavHeader(frames)),actual=new Uint8Array(bytes,0,Math.min(44,bytes.byteLength));
  if(bytes.byteLength!==44+frames*4||actual.length!==44||!header.every((v,i)=>v===actual[i]))throw Error('Invalid canonical audio source');
  bins=Math.max(1,Math.min(bins,frames));const peaks=new Float32Array(bins*2),pcm=new DataView(bytes,44);
  for(let b=0;b<bins;b++){let min=1,max=-1;for(let i=Math.floor(b*frames/bins),end=Math.floor((b+1)*frames/bins);i<end;i++){const l=pcm.getInt16(i*4,true)/32768,r=pcm.getInt16(i*4+2,true)/32768;min=Math.min(min,l,r);max=Math.max(max,l,r);}peaks[b*2]=min;peaks[b*2+1]=max;}
  return peaks;
}
