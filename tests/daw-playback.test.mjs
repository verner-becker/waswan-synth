// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {emptyProject,makeTrack,uuid} from '../web/daw-project.js';
import {assignSlots,compileProject,DawClock,trackAudible} from '../web/daw-playback.js';
const p=emptyProject();for(let i=0;i<6;i++){const t=makeTrack('midi','Track '+i);t.instrument={type:'analog',patch:Array(80).fill(0)};p.tracks.push(t);p.clips.push({id:uuid(),type:'midi',trackId:t.id,name:'Notes',position:{unit:'ticks',value:960},length:1920,loopLength:960,loop:true,notes:[{id:uuid(),pitch:48+i,velocity:90,start:0,duration:480}]});}
const slots=assignSlots(p);assert.equal(new Set(slots.values()).size,6);assert.deepEqual([...slots.values()],[4,5,6,7,0,1]);
const recording=structuredClone(p);
recording.tracks[0].instrument.type='drumx';
assert.equal(assignSlots(recording,8,0).get(recording.tracks[0].id),1,'Keep the playing Synth part out of the accompaniment');
assert(![...assignSlots(recording,8,0).values()].includes(0));
for(let i=1;i<4;i++)recording.tracks[i].instrument.type='drumx';
assert.throws(()=>assignSlots(recording,8,0),/reserves the current Synth part/);
assert.doesNotThrow(()=>assignSlots(recording),'All four kits remain available outside internal recording');
for(const track of recording.tracks)track.instrument.type='analog';
while(recording.tracks.length<8){
  const t=makeTrack('midi');
  t.instrument={type:'analog',patch:Array(80).fill(0)};
  recording.tracks.push(t);
}
assert.throws(()=>assignSlots(recording,8,0),/one part available/);
assert.equal(assignSlots(recording).size,8);
const data=compileProject(p,slots);assert.equal(data.events.length,24);assert.equal(data.events[0].frame,22050);assert.equal(data.events.at(-1).frame,55125);
p.tracks[0].solo=true;assert.equal(compileProject(p).events.length,24);assert(trackAudible(p,p.tracks[0]));assert(!trackAudible(p,p.tracks[1]));p.tracks[0].solo=false;
const log=[],states=[],clock=new DawClock((...note)=>{log.push(note);return true;},()=>log.push('stop'),state=>states.push(state));
clock.start({...data,audio:undefined,slots:undefined},1000);clock.tick(1000+22050);assert.equal(log.filter(Array.isArray).length,6);
clock.tick(1000+33075);assert.equal(log.filter(Array.isArray).length,12);clock.stop();assert.equal(states.at(-1).reason,'user');
const count=log.length;clock.tick(1000+data.length);assert.equal(log.length,count,'stopped clock cannot dispatch more notes');
const bad={...data,events:[{frame:0,part:8,note:60,velocity:100}]};assert.throws(()=>clock.start(bad,0));
const dense={...data,events:Array.from({length:513},()=>({frame:0,part:0,note:60,velocity:100}))};assert.throws(()=>clock.start(dense,0),/density/);
clock.start({...data,loop:true},0);clock.tick(data.length+22050);assert.equal(states.at(-1).cycle,1);clock.stop();
console.log('PASS DAW playback: independent slot assignment, clip loops/anchors, mute/solo, audio-frame clock, cancellation and bounded event density');
