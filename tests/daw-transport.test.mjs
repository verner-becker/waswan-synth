// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {ScheduleBuilder,prepareSchedule,timelineFrame} from '../web/daw-transport.js';
import {PcmRenderer,automationAt,stereoSample} from '../web/daw-pcm.js';
import {DawClock,audioTransport} from '../web/daw-playback.js';
const processors=new Map();globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(){}};}};globalThis.registerProcessor=(name,type)=>processors.set(name,type);await import('../web/daw-media-worklet.js');
const frameTick=f=>f*1920/44100,plan={playing:true,planId:'test',startFrame:256,fromFrame:389,length:2048,loop:true,loopStart:143,loopEnd:1004};
const volume={enabled:true,curve:'linear',points:[{tick:Math.round(frameTick(160)),value:.5},{tick:Math.round(frameTick(980)),value:1}]},pan={enabled:true,curve:'step',points:[{tick:Math.round(frameTick(300)),value:-.5},{tick:Math.round(frameTick(600)),value:.5}]};
const left=Float32Array.from({length:2000},(_,i)=>(i%100)/100),right=Float32Array.from(left,v=>-v/2),pcm=new PcmRenderer();pcm.asset('source',left,right);const clip={assetId:'source',output:0,start:100,end:1200,offset:17,gain:.5,pan:.25,fadeIn:350,fadeOut:800};pcm.prepare('test',[clip]);
const Track=processors.get('waswan-daw-track'),track=new Track();track.port.onmessage({data:{t:'prepare',planId:'test',bpm:120,volume,pan}});Object.assign(audioTransport,plan);
let compared=0;
for(let frame=0;frame<4096;frame+=128){
 const raw=[[new Float32Array(128),new Float32Array(128)]],out=[[new Float32Array(128),new Float32Array(128)]];pcm.render(raw,plan,frame);globalThis.currentFrame=frame;track.process(raw,out,{volume:new Float32Array([.5]),pan:new Float32Array([0]),mute:new Float32Array([1])});
 for(let i=0;i<128;i++){
  const elapsed=frame+i-plan.startFrame;let at=elapsed<0?-1:389+elapsed;if(at>=1004)at=143+(at-1004)%861;
  assert.equal(timelineFrame(plan,frame+i),at);
  let expected=[0,0];if(at>=100&&at<1200){const gain=.5*Math.min(1,(at-100)/350)*Math.min(1,(1200-at)/800),source=17+at-100;expected=stereoSample(left[source]*gain*.75,right[source]*gain,automationAt(volume,frameTick(at),.5),automationAt(pan,frameTick(at),0));}
  for(let channel=0;channel<2;channel++)assert(Math.abs(out[0][channel][i]-expected[channel])<1e-7,`sample ${frame+i}, channel ${channel}`);compared++;
 }
}
const neutral=new Track();neutral.port.onmessage({data:{t:'prepare',planId:'test',bpm:120}});globalThis.currentFrame=512;const input=[[new Float32Array(128).fill(.4),new Float32Array(128).fill(.2)]],out=[[new Float32Array(128),new Float32Array(128)]];neutral.process(input,out,{volume:new Float32Array([.5]),pan:new Float32Array([0]),mute:new Float32Array([1])});assert(Math.abs(out[0][0][0]-.2)<1e-7,'volume .5 is applied exactly once');
const silent=[[new Float32Array(128),new Float32Array(128)]];pcm.render(silent,{...plan,planId:'stale'},512);assert(silent[0].every(c=>c.every(v=>v===0)),'old plan cannot sound in a new generation');
const events=[{frame:0,part:4,note:60,velocity:90},{frame:50,part:4,note:80,velocity:90},{frame:142,part:4,note:72,velocity:90},{frame:143,part:4,note:80,velocity:0},{frame:143,part:4,note:70,velocity:90},{frame:200,part:4,note:65,velocity:90},{frame:300,part:4,note:60,velocity:0},{frame:500,part:4,note:65,velocity:0},{frame:1004,part:4,note:70,velocity:0},{frame:1100,part:4,note:72,velocity:0}];
const data=prepareSchedule({...plan,events});assert.deepEqual(data.initial.map(n=>n.note).sort(),[65,70,72]);assert.deepEqual(data.repeated.map(n=>n.note),[60,72],'note ending at loop start is excluded; on exactly at start is not chased twice');
let cycle=0,stops=0;const played=[];const clock=new DawClock((part,note,velocity)=>{played.push({cycle,part,note,velocity});return true;},()=>stops++);clock.startPrepared(data,256);
for(let frame=256;frame<4096;frame+=128){const position=389+frame-256;cycle=position>=1004?1+Math.floor((position-1004)/861):0;clock.tick(frame);}
for(let c=0;c<=cycle;c++)assert.equal(played.filter(e=>e.cycle===c&&e.note===70&&e.velocity).length,1,'one start/retrigger per cycle');assert(stops>=3);clock.stop();
const edgeEvents=[{frame:950,part:4,note:61,velocity:90},{frame:980,part:4,note:61,velocity:0}],edgeLog=[],edge=new DawClock((p,n,v)=>{edgeLog.push(v);return true;},()=>{});edge.start({...plan,events:edgeEvents},256);
for(let f=256;f<256+861*9;f+=128)edge.tick(f);assert.equal(edgeLog.filter(v=>v>0).length,9,'right-edge note-ons are drained in every unaligned loop cycle');assert.equal(edgeLog.filter(v=>v===0).length,9);
const ending=[],finite=new DawClock((p,n,v)=>{ending.push(v);return true;},()=>{});finite.start({length:1004,loop:false,events:edgeEvents},0);for(let f=0;f<=1024;f+=128)finite.tick(f);assert.deepEqual(ending,[90,0],'natural end drains the final fractional quantum before stopping');
assert.throws(()=>prepareSchedule({...plan,loopEnd:200,events:[]}),/interval/);
const dense=[];for(const frame of [0,1500,1950])for(let i=0;i<300;i++)dense.push({frame,part:Math.floor(i/128),note:i%128,velocity:frame===1500?0:90});assert.throws(()=>prepareSchedule({length:3000,fromFrame:1000,loop:true,loopStart:1000,loopEnd:2000,events:dense}),/seam/);
const builder=new ScheduleBuilder({length:2048,loop:false});assert.throws(()=>builder.append(Array(1025).fill(events[0])),/chunk/);
console.log(JSON.stringify({result:'PASS',samplesCompared:compared,unalignedLoopFrames:861,seekInsideFades:true,automationFollowsEveryCycle:true,volumeAppliedOnce:true,stalePlanSilent:true,chaseAndBoundaryNotes:true,seamDensityGuard:true}));
