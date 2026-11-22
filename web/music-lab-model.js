// SPDX-License-Identifier: GPL-3.0-only
const STEPS=['C','D','E','F','G','A','B'];
const SEMITONES=[0,2,4,5,7,9,11];
export const LAB_KEYS={
  C:{name:'Dó maior',fifths:0},
  F:{name:'Fá maior',fifths:-1},
  G:{name:'Sol maior',fifths:1}
};

export function pitchMidi({step,alter,octave}) {
  return (octave+1)*12+SEMITONES[STEPS.indexOf(step)]+alter;
}

export function pitchLabel({step,alter,octave}) {
  return step+(alter<0?'♭'.repeat(-alter):'♯'.repeat(alter))+octave;
}

export function transposeLesson(lesson,tonic) {
  if(tonic===lesson.key.tonic)return lesson;
  const source=STEPS.indexOf(lesson.key.tonic),target=STEPS.indexOf(tonic);
  let letters=target-source,semitones=SEMITONES[target]-SEMITONES[source];
  if(semitones>6){letters-=7;semitones-=12;}
  if(semitones< -6){letters+=7;semitones+=12;}
  const notes=lesson.notes.map(note=>{
    const midi=note.pitch.midi+semitones;
    const index=note.pitch.octave*7+STEPS.indexOf(note.pitch.step)+letters;
    const step=STEPS[index%7],octave=Math.floor(index/7);
    const alter=midi-pitchMidi({step,alter:0,octave});
    return {...note,pitch:{step,alter,octave,midi}};
  });
  // The authored fingerings apply to the original key.
  return {...lesson,key:{tonic,mode:'major',fifths:LAB_KEYS[tonic].fifths},notes:notes.map(({finger,...note})=>note)};
}

export function lessonGroups(notes) {
  const byTick=new Map();
  for(const note of notes){
    if(!byTick.has(note.startTick))byTick.set(note.startTick,[]);
    byTick.get(note.startTick).push(note);
  }
  return [...byTick].sort(([a],[b])=>a-b).map(([tick,notes])=>({tick,notes}));
}

export function lessonClef(notes) {
  const mean=notes.reduce((sum,note)=>sum+note.pitch.midi,0)/notes.length;
  return mean<60?'bass':'treble';
}

export function demoSchedule({notes,bpm,ppq},rate,part,transpose) {
  if(!Array.isArray(notes)||!notes.length||notes.length>128||ppq!==480||
      !Number.isInteger(bpm)||bpm<40||bpm>240)throw Error('Invalid Music Lab demo');
  const frames=tick=>Math.round(tick*rate*60/(bpm*ppq));
  const events=[];
  let length=0;
  for(const {midi,startTick,durationTick} of notes){
    const note=midi-transpose,end=startTick+durationTick;
    if(!Number.isInteger(midi)||midi<0||midi>127||note<0||note>127||
        !Number.isInteger(startTick)||startTick<0||!Number.isInteger(durationTick)||durationTick<1||end>ppq*128)
      throw Error('Invalid Music Lab note or transposition');
    events.push({frame:frames(startTick),part,note,velocity:86},{frame:frames(end),part,note,velocity:0});
    length=Math.max(length,end);
  }
  events.sort((a,b)=>a.frame-b.frame||a.velocity-b.velocity);
  return {events,length:frames(length),bpm,ticks:length*2,loop:false};
}
