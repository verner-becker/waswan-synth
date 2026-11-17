// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {LiveNotes} from '../web/studio-live-notes.js';
import {emptySequence,MAX_NOTES} from '../web/studio-sequence.js';
const s=emptySequence(),live=new LiveNotes(1),input=(frame,data,listening=true)=>live.input({frame,data,listening});
input(100,[144,48,100],false);assert.equal(live.count,0);input(100,[144,48,100]);input(4510,[144,48,90]);input(8920,[144,48,0]);
const notes=live.view(100,10000,s);assert.equal(notes.length,2);assert.equal(notes[0].part,1);assert.equal(notes[0].start,0);assert.equal(notes[0].duration,192);assert.equal(notes[1].duration,192);assert.equal(live.held.size,0);
input(100,[144,52,100]);input(500,[128,52,0]);assert.equal(live.view(300,10000,s).at(-1).start,0);assert(live.view(300,10000,s).at(-1).duration>0);
const loop=emptySequence();loop.loop=true;loop.length=960;const held=new LiveNotes(2);held.input({frame:21050,data:[144,60,100],listening:true});assert.equal(held.view(0,30000,loop)[0].duration,44);
for(let n=0;n<MAX_NOTES+50;n++){held.input({frame:n,data:[144,64,100],listening:true});}assert.equal(held.notes.length,MAX_NOTES);assert(held.held.size<=2);
console.log('PASS Studio live preview: raw-note timing, retrigger, note-on zero, input guard, pre-roll, loop trim, part and memory bounds');
