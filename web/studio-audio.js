// SPDX-License-Identifier: GPL-3.0-only
// Bounded, data-only PCM assets and nondestructive audio regions.
export const AUDIO_RATE=44100,MAX_ASSET_FRAMES=AUDIO_RATE*120,MAX_ASSETS=4,MAX_AUDIO_CLIPS=32;
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const id=v=>typeof v==='string'&&v.length>0&&v.length<=80;
export function validateAssets(assets=[]){
  if(!Array.isArray(assets)||assets.length>MAX_ASSETS)throw Error('Audio asset limit: four files');
  const ids=new Set();let total=0;
  for(const a of assets){if(!a||!id(a.id)||ids.has(a.id)||typeof a.name!=='string'||a.name.length>120||!int(a.frames,1,MAX_ASSET_FRAMES)||a.bytes!==44+a.frames*4)throw Error('Invalid audio asset');ids.add(a.id);total+=a.frames;}
  if(total>MAX_ASSET_FRAMES)throw Error('Imported audio limit: 120 seconds in total');return assets;
}
export function validateAudioClips(clips=[],sequence,assets){
  if(!Array.isArray(clips)||clips.length>MAX_AUDIO_CLIPS)throw Error('Audio clip limit: 32');
  const end=Math.round(sequence.length*AUDIO_RATE*60/(sequence.bpm*960)),ids=new Set();let total=0;
  if(clips.length&&end>MAX_ASSET_FRAMES)throw Error('Arrangements containing audio are limited to 120 seconds');
  for(const c of clips){
    if(!c||!id(c.id)||ids.has(c.id)||!id(c.asset)||!int(c.start,0,sequence.length-1)||!int(c.offset,0,MAX_ASSET_FRAMES-1)||!int(c.frames,1,MAX_ASSET_FRAMES-c.offset)||!Number.isFinite(c.gain)||c.gain<0||c.gain>2||!Number.isFinite(c.pan)||c.pan< -1||c.pan>1||typeof c.mute!=='boolean')throw Error('Invalid audio clip');
    if(Math.round(c.start*AUDIO_RATE*60/(sequence.bpm*960))+c.frames>end)throw Error('Audio clip extends beyond the arrangement');
    if(assets){const asset=assets.find(a=>a.id===c.asset);if(!asset||c.offset+c.frames>asset.frames)throw Error('Audio clip outside its source');}
    ids.add(c.id);total+=c.frames;
  }
  if(total>MAX_ASSET_FRAMES*2)throw Error('Audio region budget: 240 seconds before overlap');return clips;
}
export async function inspectWav(file){
  if(file.size<44||file.size>44+MAX_ASSET_FRAMES*4+65536)throw Error('WAV size exceeds the import limit');
  const head=new DataView(await file.slice(0,12).arrayBuffer()),str=(v,at,n)=>String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+at,n));
  if(str(head,0,4)!=='RIFF'||str(head,8,4)!=='WAVE'||head.getUint32(4,true)+8!==file.size)throw Error('Invalid RIFF/WAVE file');
  let at=12,fmt=null,data=null,count=0;
  while(at+8<=file.size){
    if(++count>256)throw Error('Too many WAV chunks');const h=new DataView(await file.slice(at,at+8).arrayBuffer()),name=str(h,0,4),size=h.getUint32(4,true),next=at+8+size+(size&1);
    if(next>file.size)throw Error('Truncated WAV chunk');
    if(name==='fmt '){if(fmt||size<16||size>40)throw Error('Invalid WAV format chunk');fmt=new DataView(await file.slice(at+8,at+24).arrayBuffer());}
    if(name==='data'){if(data)throw Error('Multiple WAV data chunks');data={offset:at+8,bytes:size};}at=next;
  }
  if(at!==file.size||!fmt||!data||fmt.getUint16(0,true)!==1||![1,2].includes(fmt.getUint16(2,true))||fmt.getUint32(4,true)!==AUDIO_RATE||fmt.getUint16(14,true)!==16)throw Error('Import requires PCM16 WAV, mono or stereo, 44.1 kHz');
  const channels=fmt.getUint16(2,true),block=channels*2,frames=data.bytes/block;
  if(fmt.getUint16(12,true)!==block||fmt.getUint32(8,true)!==AUDIO_RATE*block||!int(frames,1,MAX_ASSET_FRAMES))throw Error('Invalid WAV PCM layout');
  return {...data,channels,frames};
}
export function mixAudio(sequence,assets){
  validateAssets(assets.map(a=>a.meta));validateAudioClips(sequence.audioClips,sequence,assets.map(a=>a.meta));
  for(const a of assets)if(!(a.pcm instanceof ArrayBuffer)||a.pcm.byteLength!==a.meta.frames*4)throw Error('Invalid PCM source length');
  const frames=Math.round(sequence.length*AUDIO_RATE*60/(sequence.bpm*960)),left=new Float32Array(frames),right=new Float32Array(frames);
  for(const c of sequence.audioClips||[]){
    if(c.mute)continue;const a=assets.find(a=>a.meta.id===c.asset),samples=new DataView(a.pcm),start=Math.round(c.start*AUDIO_RATE*60/(sequence.bpm*960));
    // Balance preserves the original stereo image at center and attenuates the opposite side.
    const gl=c.gain*(c.pan>0?1-c.pan:1),gr=c.gain*(c.pan<0?1+c.pan:1);
    for(let i=0;i<c.frames;i++){const offset=(c.offset+i)*4;left[start+i]+=samples.getInt16(offset,true)/32768*gl;right[start+i]+=samples.getInt16(offset+2,true)/32768*gr;}
  }
  return {left,right,frames};
}
