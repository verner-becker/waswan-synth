// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {StudioClock} from '../web/studio-clock.js';
const notes=[],states=[],clock=new StudioClock((part,note,velocity)=>{notes.push({part,note,velocity,frame:now});return true;},s=>states.push(s));let now=0;
const data={length:44100,loop:false,events:[{frame:0,part:0,note:60,velocity:100},{frame:1000,part:0,note:60,velocity:0},{frame:2000,part:1,note:64,velocity:80},{frame:44000,part:1,note:64,velocity:0}]};
clock.start(data,512);for(now=0;now<45000;now+=128)clock.tick(now);
assert.equal(notes.length,4);assert.equal(notes[0].frame,512);assert(notes[1].frame-1512>=0&&notes[1].frame-1512<128);assert.equal(clock.active,false);
const before=notes.length;clock.start({...data,loop:true},now);const start=now;
for(let i=0;i<44100*60/128;i++){clock.tick(now);now+=128;}
assert(clock.active);assert.equal(clock.cycle,Math.floor((now-128-start)/44100));clock.stop();assert.equal(clock.held.size,0);assert(notes.length>before+200);
assert.throws(()=>clock.start({...data,events:[{frame:-1,part:0,note:60,velocity:100}]},now));
assert.throws(()=>clock.start({...data,events:[{frame:0,part:4,note:60,velocity:100}]},now));
const broken=new StudioClock(()=>false);broken.start(data,0);broken.tick(0);assert.equal(broken.active,false);
// Fractional loop lengths must not accumulate a rounding error on every repeat.
const fractional=new StudioClock(()=>true);fractional.start({events:[],length:2768,duration:2767.7824267782426,loop:true},0);
fractional.tick(52920000);assert.equal(fractional.cycle,Math.floor((52920000+.499999)/2767.7824267782426));
console.log('PASS Studio audio clock: bounded block scheduling, loop positions, owned-note release and invalid/unavailable schedule handling');
