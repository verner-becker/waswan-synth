// SPDX-License-Identifier: GPL-3.0-only
import {resolveEffect} from './daw-fx-catalog.js';
const impulses=new WeakMap();
function impulse(context,decay){let cache=impulses.get(context);if(!cache)impulses.set(context,cache=new Map());if(cache.has(decay))return cache.get(decay);const frames=Math.max(1,Math.round(context.sampleRate*decay)),buffer=context.createBuffer(2,frames,context.sampleRate);let seed=0x57415357;for(let c=0;c<2;c++){const data=buffer.getChannelData(c);for(let i=0;i<frames;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=((seed>>>0)/2147483648-1)*Math.exp(-6*i/frames);}}cache.set(decay,buffer);while(cache.size>12)cache.delete(cache.keys().next().value);return buffer;}
class FxEntry {
 constructor(context,e){Object.assign(this,{context,type:e.type});this.nodes=[];this.initializing=true;this.input=this.gain();this.output=this.gain();this.dry=this.gain();this.wet=this.gain();this.input.connect(this.dry).connect(this.output);this.wet.connect(this.output);
  if(e.type==='eq'){this.filters=['lowshelf','peaking','highshelf'].map(type=>{const n=context.createBiquadFilter();n.type=type;this.nodes.push(n);return n;});this.input.connect(this.filters[0]).connect(this.filters[1]).connect(this.filters[2]).connect(this.wet);}
  if(['compressor','limiter'].includes(e.type)){this.kernel=new AudioWorkletNode(context,'waswan-daw-dynamics',{outputChannelCount:[2],processorOptions:{type:e.type}});this.nodes.push(this.kernel);this.input.connect(this.kernel).connect(this.wet);this.pending=new Map();this.kernel.port.onmessage=({data:m})=>{const p=this.pending.get(m.request);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.request);m.ok?p.resolve():p.reject(Error(m.error));};}
  if(e.type==='reverb'){this.kernel=context.createConvolver();this.nodes.push(this.kernel);this.input.connect(this.kernel).connect(this.wet);}
  if(['delay','chorus'].includes(e.type)){this.kernel=context.createDelay(2);this.nodes.push(this.kernel);this.input.connect(this.kernel).connect(this.wet);if(e.type==='delay'){this.feedback=this.gain();this.kernel.connect(this.feedback).connect(this.kernel);}else{this.lfo=context.createOscillator();this.depth=this.gain();this.nodes.push(this.lfo);this.lfo.connect(this.depth).connect(this.kernel.delayTime);}}
  if(e.type==='saturation'){this.kernel=context.createWaveShaper();this.kernel.oversample='none';this.nodes.push(this.kernel);this.input.connect(this.kernel).connect(this.wet);}this.update(e);this.lfo?.start();this.initializing=false;
 }
 gain(){const n=this.context.createGain();this.nodes.push(n);return n;}
 set(param,value){if(this.initializing){param.value=value;return;}param.setTargetAtTime(value,this.context.currentTime,.005);}
 update(e){const p=e.parameters,key=JSON.stringify(e);if(key===this.key)return;const prior=this.params;this.key=key;this.params=p;this.bypass=e.bypass;const mix=['reverb','delay','chorus','saturation'].includes(e.type)?p.mix:1;this.set(this.dry.gain,e.bypass?1:1-mix);this.set(this.wet.gain,e.bypass?0:mix);
  if(e.type==='eq'){for(const [n,hz,gain,q] of [[this.filters[0],p.lowHz,p.low,.707],[this.filters[1],p.midHz,p.mid,p.q],[this.filters[2],p.highHz,p.high,.707]]){this.set(n.frequency,hz);this.set(n.gain,gain);this.set(n.Q,q);}}
  if(['compressor','limiter'].includes(e.type)){this.ready=new Promise((resolve,reject)=>{const request=crypto.randomUUID(),timer=setTimeout(()=>{this.pending.delete(request);reject(Error('Dynamics processor did not acknowledge parameters'));},10000);this.pending.set(request,{resolve,reject,timer});this.kernel.port.postMessage({request,parameters:p});});this.ready.catch(()=>{});}
  if(e.type==='reverb'&&p.decay!==prior?.decay)this.kernel.buffer=impulse(this.context,p.decay);
  if(e.type==='delay'){this.set(this.kernel.delayTime,p.time);this.set(this.feedback.gain,p.feedback);}
  if(e.type==='chorus'){this.set(this.kernel.delayTime,.012);this.set(this.lfo.frequency,p.rate);this.set(this.depth.gain,p.depth/1000);}
  if(e.type==='saturation'&&p.drive!==prior?.drive){const curve=new Float32Array(8193),norm=Math.tanh(p.drive);for(let i=0;i<curve.length;i++)curve[i]=Math.tanh((i/(curve.length-1)*2-1)*p.drive)/norm;this.kernel.curve=curve;}
 }
 dispose(){try{this.lfo?.stop();}catch{}for(const n of this.nodes)try{n.disconnect();}catch{}for(const p of this.pending?.values()||[]){clearTimeout(p.timer);p.reject(Error('Effect removed'));}this.pending?.clear();if(this.kernel?.port){this.kernel.port.postMessage({t:'dispose'});this.kernel.port.close();}}
}
export class FxChain {
 constructor(context){this.context=context;this.input=context.createGain();this.output=context.createGain();this.entries=new Map();this.input.connect(this.output);this.order='';}
 update(effects){const resolved=effects.map(resolveEffect),order=resolved.map(e=>e.id+':'+e.type).join('|');for(const e of resolved){let entry=this.entries.get(e.id);if(entry&&entry.type!==e.type){entry.dispose();this.entries.delete(e.id);entry=null;}if(!entry){entry=new FxEntry(this.context,e);this.entries.set(e.id,entry);}else entry.update(e);}
  if(order!==this.order){this.input.disconnect();for(const entry of this.entries.values())entry.output.disconnect();for(const [id,entry] of this.entries)if(!resolved.some(e=>e.id===id)){entry.dispose();this.entries.delete(id);}let previous=this.input;for(const e of resolved){const entry=this.entries.get(e.id);previous.connect(entry.input);previous=entry.output;}previous.connect(this.output);this.order=order;}}
 async ready(){await Promise.all([...this.entries.values()].map(e=>e.ready));}
 dispose(){this.input.disconnect();this.output.disconnect();for(const e of this.entries.values())e.dispose();this.entries.clear();}
}
