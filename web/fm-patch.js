// SPDX-License-Identifier: GPL-3.0-only
export const FM_HEADER=5, FM_OP_BYTES=14, FM_BYTES=FM_HEADER+6*FM_OP_BYTES;
const maxima=[1,31,99,14,99,7,99,99,99,99,99,99,99,99];
export function validToneBytes(patch) {
  if(!Array.isArray(patch)||(patch.length!==80&&patch.length!==80+FM_BYTES)||!patch.every(v=>Number.isInteger(v)&&v>=0&&v<=255))return false;
  if(patch.length===80)return true;
  return patch[80]===0xf1 &&
    patch.slice(81).every((v,i)=>v<=(i<4?[31,7,127,127][i]:maxima[(i-4)%FM_OP_BYTES]));
}
export function toneBytes(x,part,staged=false) {
  const base=staged?new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer()+part*80,80):
    Array.from({length:80},(_,i)=>x.waswan_daw_patch(part,i));
  const result=Array.from(base);
  const ptr=staged?x.waswan_fm_stage?.(0,part):x.waswan_fm_data?.(part);
  if(ptr){const fm=new Uint8Array(x.memory.buffer,ptr,FM_BYTES);if(fm[0])result.push(...fm);}
  return result;
}
export function stageTone(x,studio,part,patch) {
  if(!validToneBytes(patch))throw Error('Invalid tone snapshot');
  const base=studio?x.waswan_studio_context_buffer():x.waswan_daw_stage_buffer();
  new Uint8Array(x.memory.buffer,base+80*part,80).set(patch.slice(0,80));
  const ptr=x.waswan_fm_stage?.(studio?1:0,part);
  if(ptr){
    const fm=new Uint8Array(x.memory.buffer,ptr,FM_BYTES);
    if(patch.length===80)fm.fill(0);else fm.set(patch.slice(80));
  }else if(patch.length>80)throw Error('This build requires the FM voice engine');
}
