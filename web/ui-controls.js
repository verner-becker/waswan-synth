// SPDX-License-Identifier: GPL-3.0-only
// Stable host IDs. Ranges and musical values are supplied by the original WASM.
export const CONTROLS = [
  {id:0,key:'cutoff',name:'Cutoff',section:'Filter',legacyParam:12},
  {id:1,key:'resonance',name:'Resonance',section:'Filter',legacyParam:13},
  {id:2,key:'filter-env',name:'Filter env',section:'Envelope',legacyParam:14},
  {id:3,key:'release',name:'Amp release',section:'Envelope',legacyParam:27},
  {id:4,key:'chorus-send',name:'Chorus send',section:'Part send'},
  {id:5,key:'delay-send',name:'Delay send',section:'Part send'},
  {id:6,key:'reverb-send',name:'Reverb send',section:'Part send'},
  {id:7,key:'master',name:'Master',section:'Output'},
  ...'ABCD'.split('').map((part,i)=>({id:8+i,key:`level-${part.toLowerCase()}`,name:`Part ${part}`,section:'Mixer level'})),
];
export const controlTarget = id => `control:${CONTROLS[id].key}`;
export const controlId = target => CONTROLS.find(c=>controlTarget(c.id)===target)?.id;
export function displayValue(id,value,physical) {
  if (!Number.isFinite(value)) return '—';
  if (id===0 && Number.isFinite(physical)) return physical>=1000 ? `${(physical/1000).toFixed(2)} kHz` : `${physical} Hz`;
  if (id===3 && Number.isFinite(physical)) return physical>=1000 ? `${(physical/1000).toFixed(2)} s` : `${physical.toFixed(1)} ms`;
  if (id===2) return `${value>64?'+':''}${value-64}`;
  if (id===7) return `${Math.round(value*100/1023)} %`;
  return String(value);
}
