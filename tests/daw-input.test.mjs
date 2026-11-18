// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {DawMidiRouter} from '../web/daw-input.js';
const sent=[],raw=[],controller={notes:new Map([[72,72]]),send:m=>raw.push(m),onNote(){}},target={trackId:'piano',part:4,audible:true,channel:null};let playback=true;
const router=new DawMidiRouter({controller,target:()=>target,command:(t,m)=>sent.push({t,...m}),protect:()=>playback});
assert.equal(router.route([144,60,100]),false,'default input path is unchanged');router.enable();assert.equal(controller.notes.size,0);assert(raw.some(m=>m.st===128&&m.d1===72));assert(!raw.some(m=>m.t==='panic'));
router.route([144,60,100]);router.route([159,60,80]);assert.equal(router.held.size,2);assert(sent.some(m=>m.t==='daw-live-note'&&m.channel===15&&m.velocity===80));
target.trackId='bass';target.part=5;router.route([144,62,100]);router.route([128,60,0]);assert(sent.some(m=>m.t==='daw-live-note'&&m.part===4&&m.channel===0&&m.note===60&&m.velocity===0),'Off follows the original accepted destination');assert(router.held.has(15*128+60));
router.route([176,64,127]);target.trackId='lead';target.part=6;router.route([144,64,90]);router.route([176,64,0]);assert(sent.some(m=>m.t==='daw-live-pedal'&&m.part===5&&m.channel===0&&m.down===0));assert(sent.some(m=>m.t==='daw-live-pedal'&&m.part===6&&m.down===0));
router.route([176,120,0]);assert(router.held.has(15*128+60),'channel cleanup preserves the other channel');assert(!raw.some(m=>m.t==='panic'||m.d1===120||m.d1===123));router.release();assert.equal(router.held.size,0);assert(!raw.some(m=>m.t==='panic'));
target.audible=false;router.route([144,67,100]);assert(router.silent.has(67));assert(router.route([128,67,0]));router.disable();assert(!router.enabled);playback=false;assert.equal(router.protect(),false);
console.log('PASS MIDI input: explicit routing, channel15, original-destination Off, pedal across selection, channel panic/hotplug without global panic, silent MonitorOff, unchanged default path');
