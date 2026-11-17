// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {PPQ,emptySequence,compileNotes,validateSequence} from '../web/studio-sequence.js';
import {defaultTracks,makeClip,moveClip,duplicateClip,deleteClip,addTake} from '../web/studio-arrangement.js';
const s=emptySequence();s.notes=[{id:'one',part:0,note:60,velocity:100,start:PPQ,duration:PPQ},{id:'two',part:1,note:64,velocity:90,start:0,duration:PPQ}];
const grouped=makeClip(s,0);assert.equal(s.clips,undefined);assert.equal(grouped.clips.length,1);assert.equal(grouped.clips[0].length,4*PPQ);
const moved=moveClip(grouped,grouped.clips[0].id,8*PPQ,2);assert.equal(moved.notes[0].start,9*PPQ);assert.equal(moved.notes[0].part,2);
const copy=duplicateClip(moved,moved.clips[0].id);assert.equal(copy.clips.length,2);assert.equal(copy.notes.length,3);assert.equal(new Set(copy.notes.map(n=>n.id)).size,3);
const removed=deleteClip(copy,copy.clips[0].id);assert.equal(removed.notes.length,2);assert.equal(removed.clips.length,1);
assert.throws(()=>moveClip(grouped,grouped.clips[0].id,-1,0));assert.throws(()=>makeClip(s,3));
const tracks=structuredClone(s);tracks.tracks=defaultTracks();tracks.tracks[0].mute=true;assert(compileNotes(tracks).events.every(e=>e.part===1));tracks.tracks[0].mute=false;tracks.tracks[0].solo=true;assert(compileNotes(tracks).events.every(e=>e.part===0));
const take={context:{tempo:120},frames:44100,events:[{kind:'input',frame:22050,data:[144,67,100]},{kind:'input',frame:44100,data:[128,67,0]},{kind:'input',frame:23000,data:[224,0,80]}]};
const layer=addTake(s,take,3,-22050);assert.equal(layer.notes.length,3);assert.equal(layer.notes.at(-1).part,3);assert.equal(layer.notes.at(-1).start,0);assert.equal(layer.expression[0].data[0],227);
const early=addTake(s,{...take,events:[{kind:'input',frame:0,data:[144,67,100]},{kind:'input',frame:22050,data:[128,67,0]}]},0,-2205);assert.equal(early.notes.at(-1).start,0);assert(early.notes.at(-1).duration<PPQ);
const meter=emptySequence();meter.meter=[3,4];meter.notes=[{id:'three',part:0,note:60,velocity:90,start:0,duration:PPQ}];assert.equal(makeClip(meter,0).clips[0].length,3*PPQ);
const bad=structuredClone(grouped);bad.notes[0].start=bad.clips[0].start+bad.clips[0].length;assert.throws(()=>validateSequence(bad));
console.log('PASS Studio arrangement: grouping, move/part change, duplication, deletion, mute/solo, overdub alignment and metric bounds');
