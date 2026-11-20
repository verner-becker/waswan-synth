// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {DawClock,compileProject} from '../../web/daw-playback.js';
import {emptyProject,makeTrack,validateProject} from '../../web/daw-project.js';
import {SamplerChase} from '../../web/sampler-chase.js';
import {prepareSchedule} from '../../web/daw-transport.js';
import {instrumentBinding} from '../../web/daw-player.js';

const project=emptyProject(),track=makeTrack('midi','Sampler');
track.instrument={type:'sampler',libraryId:'physical',instrumentId:'piano',revision:1,
  path:'Instruments/Piano',patch:Array(80).fill(0)};
project.tracks.push(track);
project.clips.push({type:'midi',id:'clip',trackId:track.id,name:'Overlapping Cs',
  position:{unit:'ticks',value:0},length:960,loopLength:960,loop:false,notes:[
    {id:'switch',pitch:24,start:0,duration:16,velocity:80,channel:0},
    {id:'one',pitch:60,start:100,duration:600,velocity:80,channel:0},
    {id:'two',pitch:60,start:200,duration:200,velocity:65,channel:1}]});
assert.notDeepEqual(instrumentBinding(track.instrument),instrumentBinding({...track.instrument,revision:2}));
assert.throws(()=>validateProject({...project,tracks:[{...track,instrument:{...track.instrument,path:'../piano'}}]}));
const compiled=compileProject(project);
const fromFrame=6000,length=compiled.length, data={events:compiled.events,fromFrame,length,loop:true,loopStart:6000,loopEnd:20000};
const schedule=prepareSchedule(data);
let counter=0;
const runtime={routes:new Map([[compiled.slots.get(track.id),true]]),
  chase(p,n,v){if(v)counter++;},sequenceState:()=>counter,restoreSequenceState(s){counter=s;},resetSequence(){counter=0;}};
const chase=new SamplerChase(runtime,data);
for(const e of compiled.events)chase.append([e]);
chase.finish();
const played=[];
const clock=new DawClock((part,note,velocity,channel,id)=>{
  played.push({note,velocity,channel,id,before:counter});if(velocity)counter++;return true;
},()=>{});
clock.startPrepared({...schedule,samplerChase:chase},0);
for(let frame=0;frame<length;frame+=128)clock.tick(frame);
const pairs=played.filter(e=>e.note===60);
assert(pairs.some(e=>e.channel===1&&e.velocity===0));
assert(pairs.some(e=>e.channel===0&&e.velocity===0));
for(const channel of [0,1]){
  const ns=pairs.filter(e=>e.channel===channel);
  assert.equal(new Set(ns.map(e=>e.id)).size,1);
  assert.deepEqual([...new Set(ns.filter(e=>e.velocity).map(e=>e.before))],[channel+1]);
}
console.log('PASS sampler project references, independent note identity, seek/loop articulation and variation state');
