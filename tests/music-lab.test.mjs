// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {demoSchedule,lessonClef,lessonGroups,pitchMidi,transposeLesson} from '../web/music-lab-model.js';
import {MusicLabPreview,interruptsPreview} from '../web/music-lab-preview.js';
import right from '../web/music-lab/scale-c-major-rh-1oct.json' with {type:'json'};
import left from '../web/music-lab/scale-c-major-lh-1oct.json' with {type:'json'};
import chord from '../web/music-lab/chord-c-major-rh.json' with {type:'json'};

assert.deepEqual(right.notes.map(n=>n.pitch.midi),[60,62,64,65,67,69,71,72,71,69,67,65,64,62,60]);
assert.deepEqual(left.notes.map(n=>n.pitch.midi),right.notes.map(n=>n.pitch.midi-12));
assert.deepEqual(right.notes.slice(0,8).map(n=>n.finger),[1,2,3,1,2,3,4,5]);
assert.deepEqual(left.notes.slice(0,8).map(n=>n.finger),[5,4,3,2,1,3,2,1]);
assert.equal(lessonClef(right.notes),'treble');
assert.equal(lessonClef(left.notes),'bass');
assert.equal(lessonClef(transposeLesson(chord,'G').notes),'bass','clef follows range even for a right-hand chord');
assert.equal(lessonGroups(chord.notes).length,1);

for(const [tonic,spelling,fifths] of [['F','F0,G0,A0,B-1,C0,D0,E0,F0',-1],['G','G0,A0,B0,C0,D0,E0,F1,G0',1]]){
  const shifted=transposeLesson(right,tonic);
  assert.equal(shifted.notes.slice(0,8).map(n=>n.pitch.step+n.pitch.alter).join(','),spelling);
  assert.equal(shifted.key.fifths,fifths);
  assert(shifted.notes.every(n=>n.finger===undefined));
  assert.deepEqual(shifted.notes.map(n=>n.durationTick),right.notes.map(n=>n.durationTick));
}
for(const lesson of [right,left,chord,transposeLesson(right,'F'),transposeLesson(left,'G')]){
  assert(lesson.notes.every(n=>n.pitch.midi===pitchMidi(n.pitch)));
}

const payload=lesson=>({bpm:80,ppq:lesson.ppq,notes:lesson.notes.map(({pitch:{midi},startTick,durationTick})=>({midi,startTick,durationTick}))});
const plan=demoSchedule(payload(chord),44100,2,2);
assert.equal(plan.length,132300);
assert.deepEqual(plan.events.map(e=>[e.frame,e.note,e.velocity]),[
  [0,58,86],[0,62,86],[0,65,86],[132300,58,0],[132300,62,0],[132300,65,0]
]);
const scale=demoSchedule(payload(right),44100,2,0);
assert.deepEqual(scale.events.slice(0,3).map(e=>[e.frame,e.velocity]),[[0,86],[33075,0],[33075,86]]);
assert.equal(scale.length,16*33075);
assert.throws(()=>demoSchedule({...payload(chord),ppq:960},44100,2,0),/Invalid/);

const messages=[],notes=[];
let busy=false,capacity=256;
const instrument={
  sim_track:()=>0,sim_seq_transpose:()=>0,sim_engine:()=>0,waswan_mode:part=>[3,1,0,3][part],
  waswan_part_limit:()=>256,waswan_voice_limit:()=>256,waswan_studio_mix_value:(p,field)=>field===0?100:0,
  waswan_voice:index=>Number(index>=capacity),
  waswan_studio_note:(part,note,velocity)=>{notes.push([part,note,velocity]);return 1;}
};
const player=new MusicLabPreview({engine:()=>instrument,conflict:()=>busy,layered:()=>false,notify:m=>messages.push(m)});
player.start({token:'prior',...payload(right)},0,44100);
player.stop('stopped','prior');
assert.deepEqual(notes,[]);
player.start({token:'chord',...payload(chord)},128,44100);
player.stop('stopped','prior');
player.tick(384);
assert.deepEqual(notes,[[1,60,86],[1,64,86],[1,67,86]]);
player.tick(384+plan.length);
assert.deepEqual(notes.slice(3),[[1,60,0],[1,64,0],[1,67,0]]);
assert.equal(messages.at(-1).reason,'ended');
busy=true;
player.start({token:'blocked',...payload(chord)},0,44100);
assert.equal(messages.at(-1).reason,'busy');
busy=false;
capacity=5;
player.start({token:'full',...payload(chord)},0,44100);
player.tick(256);
assert.equal(messages.at(-1).reason,'no-voices');
assert.equal(notes.length,6,'an unavailable chord sends no partial attacks');
assert(interruptsPreview({t:'midi',st:0xbf,d1:123}));
assert(!interruptsPreview({t:'midi',st:0xb0,d1:64}));
assert(interruptsPreview({t:'daw-start'}));
assert(!interruptsPreview({t:'daw-state-request'}));
console.log('PASS Music Lab: lesson pitches, fingering and durations, clefs by range, spelled transposition, host tempo, chord scheduling, token cancellation and capacity guard');
