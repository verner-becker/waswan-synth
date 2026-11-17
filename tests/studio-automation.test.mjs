// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateAutomation,automationValue,laneFromTake} from '../web/studio-automation.js';
import {StudioClock} from '../web/studio-clock.js';
const lane={id:'cut',target:'part:0:cutoff',enabled:true,curve:'linear',points:[{tick:0,value:0},{tick:960,value:100}]};
validateAutomation([lane],1920);assert.equal(automationValue(lane,480),50);assert.equal(automationValue({...lane,curve:'step'},480),0);
assert.equal(automationValue({...lane,target:'master',points:[{tick:0,value:0},{tick:960,value:1023}]},480),512);
for(const change of [l=>l.target='enc:0',l=>l.points[1].tick=0,l=>l.points[1].value=128,l=>l.curve='code']){const l=structuredClone(lane);change(l);assert.throws(()=>validateAutomation([l],1920));}
assert.throws(()=>validateAutomation([lane,{...lane,id:'duplicate'}],1920));
const context={parts:Array.from({length:4},()=>({parameters:Array(63).fill(40)})),master:724};
assert.throws(()=>laneFromTake({context,events:[{kind:'command',command:{t:'ui-control',value:41},frame:0}]},{bpm:120,length:1920},lane.target));
const recorded=laneFromTake({context,events:[{kind:'parameter',target:lane.target,frame:4410,value:41}]},{bpm:120,length:1920},lane.target);assert.deepEqual(recorded.points,[{tick:0,value:40},{tick:192,value:41}]);
// Preserve event order within a quantum: a later pedal-down cannot revive an earlier note-off.
for(const [off,pedal,expectedOff] of [[140,200,256],[200,140,1024]]){
 let now=0;const events=[],clock=new StudioClock((part,note,velocity)=>{events.push({part,note,velocity,frame:now});return true;});
 clock.start({length:2000,loop:false,events:[{frame:0,part:0,note:60,velocity:100},{frame:off,part:0,note:60,velocity:0}],expression:[{frame:pedal,data:[176,64,127]},{frame:1000,data:[176,64,0]}]},0);
 for(now=0;now<=1024;now+=128)clock.tick(now);assert.equal(events.find(e=>e.velocity===0).frame,expectedOff);
}
const endpoint=[],ending=new StudioClock(()=>true,()=>{},(id,value)=>{endpoint.push(value);return true;});
ending.start({events:[],length:1000,duration:1000,loop:false,bpm:120,ticks:100,automation:[{id:'master',target:'master',enabled:true,curve:'linear',points:[{tick:0,value:0},{tick:100,value:1023}]}]},0);ending.tick(0);ending.tick(1024);assert.equal(endpoint.at(-1),1023,'natural end applies the exact final point');
// Run the actual wrapper and actual WASM through the same pickup path as the app.
globalThis.sampleRate=44100;globalThis.currentTime=0;globalThis.currentFrame=0;let Processor;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={onmessage:null,postMessage(){}};}};globalThis.registerProcessor=(_,P)=>Processor=P;
await import('../.local/www/simulator/dsp-worklet.js');
const seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin'),p=new Processor({processorOptions:{wasm:fs.readFileSync('.local/build/waswan-256.wasm'),store:seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength)}});
p.engine.advance(5000);const x=p.engine.ex,scope=x.waswan_ui_scope();p.engine.input({t:'ui-control',source:'ui',id:0,value:40,scope});
const observed=[];p.port.onmessage({data:{t:'studio-events-connect',port:{postMessage:m=>observed.push(m),close(){}}}});
const outputs=[[new Float32Array(128),new Float32Array(128)]];
for(const value of [5,40,41]){p.port.onmessage({data:{t:'ui-control',source:'midi',id:0,scope,revision:1,mode:'absolute',behavior:'fine',value}});p.process([],outputs);currentFrame+=128;currentTime=currentFrame/44100;}
const applied=observed.filter(e=>e.t==='parameter'&&e.target===lane.target);assert.equal(applied.length,1);assert.equal(applied[0].value,41);assert.equal(applied[0].frame,384);
assert.equal(observed.filter(e=>e.t==='command').length,3,'all three input attempts remain distinct from one actual change');
console.log('PASS Studio automation: native resolution, interpolation, lane guards, applied-control import, pedal ordering and real pickup observation');
