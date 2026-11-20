// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {DawMidiRouter} from '../../web/daw-input.js';
import {midiWindow} from '../../web/daw-clip-window.js';
import {midiBlob} from '../../web/daw-midi-export.js';
import {MidiTake} from '../../web/daw-midi-take.js';
import {DawClock,compileProject} from '../../web/daw-playback.js';
import {emptyProject,makeTrack} from '../../web/daw-project.js';
import {applySamplerControl} from '../../web/daw-sampler-midi.js';
import {prepareSchedule} from '../../web/daw-transport.js';
import {SamplerChase} from '../../web/sampler-chase.js';
import {projectBlob,readProject} from '../../web/daw-format.js';

const recorded = [
  {frame:200,data:[176,64,99]},
  {frame:300,data:[176,74,31]},
  {frame:400,data:[176,71,60]},
  {frame:1000,data:[144,60,112]},
  {frame:1200,data:[148,60,90]},
  {frame:1350,data:[212,80]},
  {frame:1400,data:[128,60,0]},
  {frame:1500,data:[164,60,70]},
  {frame:1700,data:[228,0,80]},
  {frame:1800,data:[132,60,0]},
  {frame:4000,data:[176,64,0]},
];
const project = emptyProject(), track = makeTrack('midi','Sampler');
track.instrument = {type:'sampler',libraryId:'physical',instrumentId:'kit',revision:1,path:'Kits/Kit',patch:Array(80).fill(0)};
project.tracks.push(track);
const take = new MidiTake(null,{sampler:true}), legacy = new MidiTake();
for (const event of recorded) { take.input(event); legacy.input(event); }
const meta = {trackId:track.id,name:'Recorded expression',startFrame:0,endFrame:6000,fromFrame:0,bpm:120};
const clip = take.clip(meta), oldClip = legacy.clip(meta);
assert.equal(clip.notes.length, 2);
assert(clip.notes[0].duration < oldClip.notes[0].duration / 2, 'Sampler take records physical key release');
assert.deepEqual(oldClip.midiEvents.map(e => e.type), ['bend']);
assert(clip.midiEvents.some(e => e.type==='channelPressure'&&e.channel===4&&e.value===80));
assert(clip.midiEvents.some(e => e.type==='polyPressure'&&e.channel===4&&e.note===60&&e.value===70));
assert.deepEqual(clip.midiEvents.filter(e => e.controller===64).map(e => e.value), [99,0]);
const view = midiWindow({...clip,offsetTicks:30,length:clip.length-30});
assert.deepEqual(view.events.filter(e => e.tick===0).map(e => e.controller), [64,74,71]);
project.clips.push(clip);
const reopened = await readProject(await projectBlob(project,new Map()));
assert.deepEqual(reopened.project.clips[0], clip);
await reopened.dispose();
const exportBytes = Buffer.from(await midiBlob(project).arrayBuffer());
for (const pattern of [[176,64,99],[176,74,31],[176,71,60],[212,80],[164,60,70],[228,0,80],[176,64,0]]) {
  assert(exportBytes.includes(Buffer.from(pattern)), `Missing raw performance bytes ${pattern}`);
}

const compiled = compileProject(project), part = compiled.slots.get(track.id);
const changed = structuredClone(project);
changed.tracks[0].instrument = {type:'analog',patch:Array(80).fill(0)};
assert.deepEqual(compileProject(changed).events.filter(e => e.type).map(e => [e.type,e.channel]), [['bend',undefined]]);
const data = {events:compiled.events,fromFrame:2600,length:10000,loop:true,loopStart:2600,loopEnd:8000};
const schedule = prepareSchedule(data);
assert.deepEqual(schedule.initial.map(e => [e.note,e.channel,e.released]), [[60,0,true]]);
const calls = [], controls = new Map();
const runtime = {
  routes:new Map([[part,true]]),
  x:{waswan_sampler_control(part,channel,source,kind,number,value,silent) {
    calls.push([part,channel,source,kind,number,value,silent]);
    controls.set(`${part}:${channel}:${kind}:${number}`,value);
    return true;
  }},
  resetSequence(){ controls.clear(); },
  sequenceState(){ return [...controls]; },
  restoreSequenceState(state){ controls.clear(); for (const [key,value] of state) controls.set(key,value); },
  chase(){},
};
const samplerChase = new SamplerChase(runtime,data);
samplerChase.append(compiled.events);
samplerChase.finish();
assert(calls.some(args => args[1]===4&&args[3]===1&&args[5]===80&&args[6]===1));
assert(calls.some(args => args[1]===4&&args[3]===2&&args[4]===60&&args[5]===70&&args[6]===1));
const played = [];
const clock = new DawClock((slot,pitch,velocity,channel,id) => { played.push({slot,pitch,velocity,channel,id}); return true; },
  ()=>{},()=>{},8,()=>true,event=>applySamplerControl(runtime.x,event.part,0,event));
clock.startPrepared({...schedule,samplerChase},0);
for (let frame=0; frame<10000; frame+=128) clock.tick(frame);
assert.deepEqual(played.map(e => [e.pitch,e.channel,e.velocity]), [[60,0,112],[60,0,0],[60,0,112],[60,0,0]]);
assert.equal(new Set(played.map(e => e.id)).size, 1);
assert.equal(calls.filter(args => args[1]===0&&args[3]===0&&args[4]===64&&args[5]===0&&args[6]===0).length, 2);

const commands = [];
let target = {trackId:'kit-a',part:4,audible:true,channel:null,sampler:true};
const router = new DawMidiRouter({controller:{notes:new Map(),send(){},onNote(){}},target:()=>target,
  command:(type,event)=>commands.push({type,event})});
router.enable();
router.route([144,60,100]);
assert.equal(router.route([208,96]), true);
router.route([148,60,110]);
target = {trackId:'kit-b',part:5,audible:true,channel:null,sampler:true};
router.route([164,60,42]);
assert.deepEqual(commands.filter(m => m.type==='daw-live-control').map(m => [m.event.part,m.event.channel,m.event.type,m.event.value]),
  [[4,0,'channelPressure',96],[4,4,'polyPressure',42],[5,4,'polyPressure',42]]);
router.route([128,60,0]);
assert(commands.some(m => m.type==='daw-live-note'&&m.event.part===4&&m.event.channel===0&&m.event.velocity===0));
router.dropPart(4);
assert.equal(router.samplerParts[0].has(4), false);
console.log('PASS sampler MIDI capture, raw SMF export, pedal chase, expression and note ownership by channel');
