// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {accumulator,block,merge,metrics,BINS} from '../.local/www/simulator/dsp-stats.js';
let a=accumulator(),b=accumulator();for(let i=0;i<99;i++)block(a,.1,128,44100);block(b,10,128,44100);merge(a,b);
assert.equal(metrics(a).p99Ms,.125);assert.equal(metrics(a).overBudget,1);assert.equal(metrics(a).measuredBlocks,100);assert(Math.abs(metrics(a).meanMs-(99*.1+10)/100)<1e-12);
block(a,100,256,44100);assert.equal(metrics(a).p99Ms,10.025);assert.equal(metrics(a).maxMs,100);assert.equal(a.overflow,1);
block(a,-1,128,44100);assert.equal(a.invalid,1);block(a,null,128,44100);assert.equal(metrics(a).blocks,103);
const unknown=accumulator();block(unknown,null,64,48000);assert.equal(metrics(unknown).p99Ms,null);assert.equal(metrics(unknown).overBudget,null);assert.equal(metrics(unknown).budgetMs,1000*64/48000);
// Run the actual wrapped processor in a deterministic AudioWorklet harness.
globalThis.sampleRate=44100;globalThis.currentTime=0;let Processor;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={onmessage:null,postMessage:m=>{this.messages.push(structuredClone(m));}};this.messages=[];}};
globalThis.registerProcessor=(name,P)=>Processor=P;
await import('../.local/www/simulator/dsp-worklet.js');
const wasm=fs.readFileSync('.local/build/waswan-256.wasm'),seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
function fixture(state){currentTime=0;const p=new Processor({processorOptions:{wasm,store:seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength)}});p.engine.advance(5000);p.engine.input({t:'voice-mode',part:0,mode:1});for(let i=0;i<128;i++)p.engine.input({t:'midi',st:0x90,d1:i,d2:100});p.engine.render(512);assert.equal(p.engine.frame().polyphony.slots.filter(v=>v.gate).length,256);if(state!=='off')p.port.onmessage({data:{t:'dsp-control',action:state==='capture'?'start':'enable',enabled:true,session:'test'}});return p;}
const outputs=[[new Float32Array(128),new Float32Array(128)]];
function run(p,n,collect=false){const samples=collect?new Float32Array(n*256):null;const start=performance.now();let peakMessages=0;for(let i=0;i<n;i++){if(collect){if(i===100)p.engine.input({t:'voice-sustain',enabled:true});if(i===200)for(let k=0;k<128;k++)p.engine.input({t:'midi',st:0x80,d1:k,d2:0});if(i===400)p.engine.input({t:'midi',st:0xe0,d1:0,d2:80});if(i===600)p.engine.input({t:'voice-sustain',enabled:false});if(i===800)for(let k=48;k<60;k++)p.engine.input({t:'midi',st:0x90,d1:k,d2:100});if(i===1000)p.engine.input({t:'panic'});}p.process([],outputs);if(collect){samples.set(outputs[0][0],i*256);samples.set(outputs[0][1],i*256+128);}currentTime+=128/44100;peakMessages=Math.max(peakMessages,p.messages.length);p.messages.length=0;}return {wallMs:performance.now()-start,samples,peakMessages};}
const off=run(fixture('off'),1500,true);for(const state of ['live','capture'])assert.deepEqual(run(fixture(state),1500,true).samples,off.samples,'bit-identical audio: '+state);
const noClock=fixture('capture');noClock.clock=null;noClock.clockName=null;run(noClock,344);noClock.process([],outputs);noClock.port.onmessage({data:{t:'dsp-control',action:'stop'}});assert.equal(noClock.messages.at(-1).measurement.state,'unavailable');
const stopped=fixture('capture');run(stopped,12);stopped.port.onmessage({data:{t:'dsp-control',action:'stop'}});assert.equal(stopped.messages.at(-1).final,true);assert.equal(stopped.messages.at(-1).stats.blocks,12);
const reboot=fixture('capture');run(reboot,2);reboot.port.onmessage({data:{t:'reboot'}});assert(reboot.messages.some(m=>m.final&&m.reason==='reboot'));
// Warm up all paths, then alternate modes to limit ordering bias. Time actual wrapper + original callback.
for(const s of ['off','live','capture'])run(fixture(s),1000);
const bench={off:[],live:[],capture:[]};for(let round=0;round<5;round++)for(const s of (round%2?['capture','live','off']:['off','live','capture'])){bench[s].push(run(fixture(s),3446).wallMs);}
const median=v=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)];const base=median(bench.off);
const report={result:'PASS',blocksPerRun:3446,audioSecondsPerRun:3446*128/44100,voices:256,clock:'performance.now (Node harness)',runsMs:bench,medianMs:Object.fromEntries(Object.entries(bench).map(([k,v])=>[k,median(v)])),overheadPercent:Object.fromEntries(Object.entries(bench).map(([k,v])=>[k,100*(median(v)/base-1)])),audio:'bit-identical off/live/capture; 384000 scalar samples / 192000 stereo frames each',histogramBins:BINS};
fs.writeFileSync('.local/validation/dsp-monitor-native.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
