// SPDX-License-Identifier: GPL-3.0-only
import {CONTROLS,controlId,controlTarget} from './ui-controls.js';
export const STORAGE_KEY = 'waswan-midi-profile-v1';
export const TARGETS = [
  ...CONTROLS.map(c=>({id:controlTarget(c.id),label:`Performance · ${c.name}`})),
  ...Array.from({length:4}, (_, i) => ({id:`fader:${i}`, label:`F${i+1} · Fader ${i+1}`})),
  ...['Screen 1','Screen 2','Screen 3','Screen 4','Navigation','Part','Preset','Master']
    .map((label,i) => ({id:`enc:${i}`, label:`K${i+1} · ${label}`})),
];
export const MODES = ['absolute','offset','twos'];
export const fineTarget = target => /^enc:[0-3]$/.test(target) || controlId(target)!==undefined;
const validTarget = id => TARGETS.some(t => t.id === id);
const validBinding = b => b && typeof b.port === 'string' && b.port.length > 0 &&
  Number.isInteger(b.channel) && b.channel >= 0 && b.channel < 16 &&
  Number.isInteger(b.cc) && b.cc >= 0 && b.cc < 120 && validTarget(b.target) &&
  MODES.includes(b.mode) && (!b.target.startsWith('fader:') || b.mode === 'absolute');
const sourceKey = b => JSON.stringify([b.port,b.channel,b.cc]);

export class MidiProfile {
  constructor(storage) {
    this.storage = storage;
    this.enabled = false;
    this.bindings = [];
    this.previous = new Map();
    this.learning = null;
    this.context = null;
    this.controlScope = null;
    this.revision = 0;
    this.onChange = () => {};
    this.persistenceError = false;
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (saved?.version === 1 && typeof saved.enabled === 'boolean' && Array.isArray(saved.bindings)) {
        for (const b of saved.bindings.filter(validBinding)) {
          this.bindings = this.bindings.filter(x => x.target !== b.target && sourceKey(x) !== sourceKey(b));
          this.bindings.push({...b,behavior:b.behavior==='fine'&&fineTarget(b.target)?'fine':'normal'});
        }
        this.enabled = saved.enabled;
      }
    } catch { /* Um perfil inválido não impede a execução do instrumento. */ }
  }
  save() {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({version:1,enabled:this.enabled,bindings:this.bindings}));
      this.persistenceError = false;
    } catch { this.persistenceError = true; }
    this.onChange();
  }
  reset() {
    this.revision=(this.revision+1)>>>0;
    this.previous.clear();
    this.learning = null;
    this.context = null;
    this.controlScope = null;
    this.onChange();
  }
  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.reset();
    this.save();
  }
  setContext(context) {
    if (this.context === context) return;
    this.context = context;
    this.revision=(this.revision+1)>>>0;
    for (const b of this.bindings) if (b.behavior === 'fine') this.previous.delete(sourceKey(b));
  }
  setBehavior(target, behavior) {
    if (!['normal','fine'].includes(behavior) || (behavior==='fine'&&!fineTarget(target))) return false;
    const binding=this.bindings.find(b=>b.target===target);
    if (!binding) return false;
    this.revision=(this.revision+1)>>>0;
    binding.behavior=behavior;this.previous.delete(sourceKey(binding));this.save();return true;
  }
  learn(target, mode, behavior='normal') {
    if (!this.enabled || !validTarget(target) || !MODES.includes(mode) ||
      (target.startsWith('fader:') && mode !== 'absolute') || !['normal','fine'].includes(behavior) ||
      (behavior==='fine'&&!fineTarget(target))) return false;
    this.revision=(this.revision+1)>>>0;
    this.learning = {target,mode,behavior};
    this.onChange();
    return true;
  }
  remove(target) {
    this.bindings = this.bindings.filter(b => b.target !== target);
    this.reset();
    this.save();
  }
  handle(data, port, send) {
    if (!this.enabled || !port || !data || data.length !== 3 ||
      !Array.from(data).every(Number.isInteger)) return false;
    const [status,cc,value] = data;
    // Nunca capturar Channel Mode (CC120–127), notas ou rodas de pitch.
    if (status < 0xb0 || status > 0xbf || cc < 0 || cc >= 120 || value < 0 || value > 127) return false;
    const source = {port,channel:status&15,cc};
    const key = sourceKey(source);
    if (this.learning) {
      const b = {...source,...this.learning};
      this.bindings = this.bindings.filter(x => x.target !== b.target && sourceKey(x) !== key);
      this.bindings.push(b);
      this.learning = null;
      this.previous.clear();
      // Captura somente a identidade. O gesto de aprendizado não altera o som.
      this.previous.set(key, value);
      this.save();
      return true;
    }
    const binding = this.bindings.find(b => sourceKey(b) === key);
    if (!binding) return false;
    if(binding.target.startsWith('control:')){
      const steps=binding.mode==='offset'?(value===0?0:value-64):value<64?value:value-128;
      this.previous.set(key,value);
      send({t:'ui-control',source:'midi',id:controlId(binding.target),scope:this.controlScope,
        revision:this.revision,mode:binding.mode,behavior:binding.behavior,
        ...(binding.mode==='absolute'?{value}:{steps})});
      return true;
    }
    const [kind,index] = binding.target.split(':');
    const i = Number(index);
    if (kind === 'fader') {
      send({t:'fader',f:i,v:value});
      return true;
    }
    if (binding.behavior==='fine' && binding.mode==='absolute') {
      this.previous.set(key,value);
      send({t:'enc-fine-absolute',e:i,value,context:this.context,revision:this.revision});
      return true;
    }
    let steps;
    if (binding.mode === 'absolute') {
      const previous = this.previous.get(key);
      this.previous.set(key,value);
      if (previous === undefined) return true;
      // K8 usa passos de 24 no firmware, com faixa de master 0–1023.
      const position = v => i === 7 ? Math.round(v*1023/(127*24)) : v;
      steps = position(value) - position(previous);
    } else if (binding.mode === 'offset') {
      steps = value === 0 ? 0 : value - 64;
    } else {
      steps = value < 64 ? value : value - 128;
    }
    if (steps) send(binding.behavior==='fine'
      ? {t:'enc-fine',e:i,steps,context:this.context}
      : {t:'enc',e:i,steps});
    return true;
  }
}
