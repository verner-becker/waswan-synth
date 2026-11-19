// SPDX-License-Identifier: GPL-3.0-only
export const tapeControls=[
  ['mix','Bank B mix (%)',0,100,50],['transpose','Transpose (semitones)',-24,24,0],
  ['cents','Fine tune (cents)',-100,100,0],['attack','Attack (ms)',1,2000,10],
  ['release','Release (ms)',1,4000,120],['loop','Continuous loop',0,1,0],
  ['velocity','Velocity response',0,1,0],['wow','Wow (%)',0,100,0],
  ['flutter','Flutter (%)',0,100,0],['wear','Wear (%)',0,100,0],
  ['drive','Saturation (%)',0,100,0]
];
export const tapeDefaults=()=>Object.fromEntries(tapeControls.map(([key,,,,value])=>[key,value]));
export const validTapeSettings=s=>tapeControls.every(([key,,min,max])=>
  Number.isInteger(s?.[key])&&s[key]>=min&&s[key]<=max);
export const validTape=t=>typeof t?.id==='string'&&/^[a-f0-9]{64}$/.test(t.id)&&
  Array.isArray(t.banks)&&t.banks.length===2&&t.banks.every(n=>typeof n==='string'&&n.length>0&&n.length<=255)&&validTapeSettings(t.settings);
export const pairFrames=8*1024*1024, maxRegions=48;
