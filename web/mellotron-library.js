// SPDX-License-Identifier: GPL-3.0-only
import {readSample} from './mellotron-wav.js';
import {pairFrames,maxRegions} from './mellotron-settings.js';

export const rehearsalBanks=['Rehearsal flute','Rehearsal strings'];
// Original harmonic studies for auditioning without a licensed tape collection.
function rehearsal(index){
  const pcm=new Int16Array(8*44100),hz=440*2**(-9/12);
  for(let i=0;i<pcm.length;i++){
    const phase=2*Math.PI*i*hz/44100;
    const harmonic=index?Math.sin(2*phase)*.42+Math.sin(3*phase)*.32:Math.sin(3*phase)*.08;
    pcm[i]=8000*(Math.sin(phase)+harmonic)*(.9+.1*Math.sin(2*Math.PI*i/44100*1.3));
  }
  return {pcm,root:60};
}
async function entries(dir){
  const result=[];
  for await(const entry of dir.values()){
    if(entry.kind!=='file'||!entry.name.toLowerCase().endsWith('.wav'))continue;
    const match=/^(\d{1,3})(?:[ _-].*)?\.wav$/i.exec(entry.name);
    if(!match||Number(match[1])>127)throw Error('Start each WAV name with its MIDI root, e.g. 60 Flute.wav.');
    const root=Number(match[1]);
    if(result.some(r=>r.root===root))throw Error('Duplicate MIDI root '+root+' in '+dir.name);
    result.push({root,entry});
    if(result.length>maxRegions)throw Error('Use up to 48 regions across both banks.');
  }
  if(!result.length)throw Error('No WAVs in '+dir.name);
  return result.sort((a,b)=>a.root-b.root);
}
export async function preparePair(folder,banks){
  const regions=[],signature=[];
  let frames=0;
  for(let bank=0;bank<2;bank++){
    const name=banks[bank];
    const files=folder?await entries(await folder.getDirectoryHandle(name)):[{root:60}];
    if(regions.length+files.length>maxRegions)throw Error('Use up to 48 regions across both banks.');
    for(const {root,entry} of files){
      const {pcm}=folder?await readSample(await entry.getFile(),root):rehearsal(rehearsalBanks.indexOf(name));
      frames+=pcm.length;
      if(frames>pairFrames)throw Error('The selected banks exceed 16 MiB of PCM.');
      signature.push([bank,name,root,await digest(pcm)]);
      regions.push({bank,root,pcm});
    }
  }
  return {regions,id:await digest(new TextEncoder().encode(JSON.stringify(signature)))};
}
async function digest(bytes){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
}
