// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {MAX_FRAMES} from '../web/studio-format.js';
let Processor;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={onmessage:null,postMessage:m=>this.messages.push(m)};}};
globalThis.registerProcessor=(_,P)=>Processor=P;
await import('../web/studio-capture.js');
const send=(p,m)=>p.port.onmessage({data:m});
const input=[[Float32Array.from({length:128},(_,i)=>Math.sin(i)),Float32Array.from({length:128},(_,i)=>Math.cos(i))]];
const output=[[new Float32Array(128),new Float32Array(128)]];
const p=new Processor();for(let i=0;i<8;i++)send(p,{t:'buffer',buffer:new ArrayBuffer(4096*8)});
send(p,{t:'start'});const source=structuredClone(input);
for(let i=0;i<33;i++){p.process(input,output);currentFrame+=128;}
send(p,{t:'stop',reason:'user'});
const chunks=p.messages.filter(m=>m.t==='chunk'),end=p.messages.find(m=>m.t==='ended');
assert.equal(chunks.length,2);assert.equal(chunks[0].frames,4096);assert.equal(chunks[1].frames,128);assert.equal(end.frames,4224);assert.equal(end.reason,'user');
assert.deepEqual(input,source,'capture never modifies the synth output');
assert(output[0].every(channel=>channel.every(v=>v===0)),'tap does not double the monitored output');
for(const chunk of chunks){const a=new Float32Array(chunk.buffer);for(let i=0;i<chunk.frames;i++){assert.equal(a[i*2],input[0][0][i%128]);assert.equal(a[i*2+1],input[0][1][i%128]);}}
const overrun=new Processor();send(overrun,{t:'start'});overrun.process(input,output);assert.equal(overrun.messages.at(-1).reason,'buffer-overrun');assert.equal(overrun.frames,0);
const nonfinite=new Processor();send(nonfinite,{t:'buffer',buffer:new ArrayBuffer(4096*8)});send(nonfinite,{t:'start'});const bad=[[new Float32Array(128).fill(NaN),new Float32Array(128)]];nonfinite.process(bad,output);send(nonfinite,{t:'stop'});assert(Number.isNaN(new Float32Array(nonfinite.messages.find(m=>m.t==='chunk').buffer)[0]),'non-finite samples must reach validation without being masked');
const limit=new Processor();send(limit,{t:'buffer',buffer:new ArrayBuffer(4096*8)});send(limit,{t:'start'});limit.frames=MAX_FRAMES-64;limit.process(input,output);assert.equal(limit.messages.at(-1).frames,MAX_FRAMES);assert.equal(limit.messages.at(-1).reason,'duration-limit');
currentFrame=0;const deadline=new Processor();send(deadline,{t:'buffer',buffer:new ArrayBuffer(4096*8)});send(deadline,{t:'start'});send(deadline,{t:'stop-at',frame:177,reason:'arrangement-end'});deadline.process(input,output);currentFrame=128;deadline.process(input,output);assert.equal(deadline.messages.at(-1).frames,177);assert.equal(deadline.messages.at(-1).reason,'arrangement-end');
console.log('PASS Studio tap: exact stereo samples, silent output, partial flush, overrun, non-finite preservation and duration boundary');
