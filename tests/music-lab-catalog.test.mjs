// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {LAB_LESSONS,lessonChordSymbol} from '../web/music-lab-catalog.js';
import {barCount,demoSchedule,fittingOctave,lessonGroups,lessonKeys,lessonRange,lessonVariant,notationKey,pitchLabel,pitchMidi,transposeLesson} from '../web/music-lab-model.js';
import {LabAssessment,labMidiEvent} from '../web/music-lab-assessment.js';
import {lessonProgressKey} from '../web/music-lab-progress.js';

const lesson=id=>LAB_LESSONS.find(entry=>entry.data.id===id).data;
const right=lesson('scale-c-major-rh-1oct'),natural=lesson('scale-a-natural-minor-rh');
const harmonic=lesson('scale-a-harmonic-minor-rh'),melodic=lesson('scale-a-melodic-minor-rh');
const spell=notes=>notes.map(note=>pitchLabel(note.pitch).replace(/-?\d+$/,'')).join(' ');
const formulas=[
  [right,[0,2,4,5,7,9,11,12]],[natural,[0,2,3,5,7,8,10,12]],
  [harmonic,[0,2,3,5,7,8,11,12]],[melodic,[0,2,3,5,7,9,11,12]]
];
for(const [source,formula] of formulas){
  const keys=Object.keys(lessonKeys(source));
  assert.equal(keys.length,12);
  assert.equal(new Set(keys.map(key=>transposeLesson(source,key).notes[0].pitch.midi%12)).size,12);
  for(const key of keys){
    const transposed=transposeLesson(source,key);
    const ascending=transposed.notes.slice(0,8);
    const midi=ascending[0].pitch.midi;
    assert.deepEqual(ascending.map(n=>n.pitch.midi-midi),formula);
    assert.equal(new Set(ascending.slice(0,7).map(n=>n.pitch.step)).size,7);
    assert(ascending.every(n=>pitchMidi(n.pitch)===n.pitch.midi&&Math.abs(n.pitch.alter)<=2));
  }
}
assert.equal(spell(transposeLesson(right,'F#').notes.slice(0,8)),'F♯ G♯ A♯ B C♯ D♯ E♯ F♯');
assert.equal(spell(transposeLesson(right,'Db').notes.slice(0,8)),'D♭ E♭ F G♭ A♭ B♭ C D♭');
assert.equal(spell(transposeLesson(harmonic,'D#').notes.slice(0,8)),'D♯ E♯ F♯ G♯ A♯ B C𝄪 D♯');
assert.equal(spell(melodic.notes.slice(7)),'A G F E D C B A');
assert.equal(notationKey(transposeLesson(harmonic,'D#').key),'D#m');
for(const entry of LAB_LESSONS)for(const tonic of Object.keys(lessonKeys(entry.data))){
  const transposed=transposeLesson(entry.data,tonic);
  assert(transposed.notes.every(n=>pitchMidi(n.pitch)===n.pitch.midi&&n.pitch.midi>=0&&n.pitch.midi<=127));
}
assert.equal(lessonChordSymbol(lesson('chord-c-first-inversion-rh'),''),'C/E');
assert.equal(lessonChordSymbol(lesson('chord-c-second-inversion-rh'),''),'C/G');
assert.equal(spell(lesson('chord-c-diminished-seventh-rh').notes),'C E♭ G♭ B𝄫');
assert.equal(spell(lesson('chord-c-major-seventh-rh').notes),'C E G B');
assert.equal(spell(lesson('chord-c-dominant-seventh-rh').notes),'C E G B♭');

const together=lesson('hands-together-c-basic');
const needed=lessonRange(together);
assert.deepEqual(needed,{min:48,max:67});
assert.equal(fittingOctave(needed,{min:60,max:96}),1);
assert.equal(fittingOctave(needed,{min:60,max:76}),null);
assert.equal(fittingOctave(needed,{min:24,max:53}),-2);
const raised=lessonVariant(together,{octaves:1});
assert.deepEqual(lessonRange(raised),{min:60,max:79});
assert.equal(raised.notes.at(-1).finger,5);
const lh=lessonVariant(together,{hand:'LH'});
assert.deepEqual(lh.notes.map(n=>n.pitch.midi),[48]);
assert.equal(lessonProgressKey(lh),'hands-together-c-basic@1:C:lh');
assert.equal(lessonProgressKey(right),'scale-c-major-rh-1oct@1:C');
const short=lessonVariant(right,{bar:4});
assert.equal(barCount(short),1);
assert.deepEqual(short.notes.map(n=>[n.pitch.midi,n.startTick,n.durationTick]),[[64,0,480],[62,480,480],[60,960,960]]);
const plan=demoSchedule({loop:true,ppq:480,bpm:100,notes:short.notes.map(n=>({...n,midi:n.pitch.midi}))},44100,2,0);
assert.equal(plan.loop,true);
assert.equal(plan.length,105840);

const groups=lessonGroups(together.notes,{withHolds:true});
assert.deepEqual(groups.map(g=>[g.notes.map(n=>n.pitch.midi),g.held.map(n=>n.pitch.midi)]),[[[60,48],[]],[[62],[48]],[[64],[48]],[[67],[48]]]);
const guided=new LabAssessment(groups,{channel:0,bpm:60,ppq:480,chordWindowMs:180});
const hit=(pitch,time)=>guided.input(labMidiEvent({data:[0x90,pitch,80],timeStamp:time}));
const off=(pitch,time)=>guided.input(labMidiEvent({data:[0x80,pitch,0],timeStamp:time}));
assert.equal(hit(48,0).kind,'partial');
assert.equal(hit(60,160).kind,'match');
off(60,300);
assert.equal(hit(62,400).kind,'match');
off(48,500);
assert.equal(hit(64,700).kind,'anchor-missing');
assert.equal(guided.index,2);
assert.equal(hit(48,800).kind,'anchor');
assert.equal(hit(64,810).kind,'match');
assert.equal(hit(67,1200).kind,'match');
assert(!guided.complete);
for(const pitch of [62,64,67,48])off(pitch,1600);
assert(guided.complete);
assert.equal(guided.summary().extras,0);
console.log('PASS W3 catalog: 12 major/minor roots, spelled scale families, chords, grand-staff events, playable range, clips and held bass');
