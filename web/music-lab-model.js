// SPDX-License-Identifier: GPL-3.0-only
const STEPS=['C','D','E','F','G','A','B'];
const SEMITONES=[0,2,4,5,7,9,11];
const TONIC_NAMES=['Dó','Ré','Mi','Fá','Sol','Lá','Si'];
const SIGNATURES=[
  ['C','A',0],['Db','Bb',-5],['D','B',2],['Eb','C',-3],['E','C#',4],['F','D',-1],
  ['F#','D#',6],['G','E',1],['Ab','F',-4],['A','F#',3],['Bb','G',-2],['B','G#',5]
];
export const LAB_KEYS=Object.fromEntries(SIGNATURES.map(([tonic,,fifths])=>[tonic,{name:keyName(tonic,'major'),fifths}]));
const MINOR_KEYS=Object.fromEntries(SIGNATURES.map(([,tonic,fifths])=>[tonic,{name:keyName(tonic,'minor'),fifths}]));

function accidentalName(alter) {
  if(alter===-2)return '𝄫';
  if(alter===2)return '𝄪';
  return alter<0?'♭':alter>0?'♯':'';
}

export function tonicName(tonic) {
  return TONIC_NAMES[STEPS.indexOf(tonic[0])]+(tonic.endsWith('#')?'♯':tonic.endsWith('b')?'♭':'');
}

function keyName(tonic,mode) {
  return tonicName(tonic)+(mode==='minor'?' menor':' maior');
}

export const lessonKeys=lesson=>lesson.key.mode==='minor'?MINOR_KEYS:LAB_KEYS;
export const notationKey=key=>key.tonic+(key.mode==='minor'?'m':'');

export function pitchMidi({step,alter,octave}) {
  return (octave+1)*12+SEMITONES[STEPS.indexOf(step)]+alter;
}

export function pitchLabel({step,alter,octave}) {
  return step+accidentalName(alter)+octave;
}

export function midiPitchLabel(midi) {
  const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  return names[midi%12]+(Math.floor(midi/12)-1);
}

export function transposeLesson(lesson,tonic) {
  if(tonic===lesson.key.tonic)return lesson;
  const fifths=lessonKeys(lesson)[tonic].fifths;
  const source=lesson.key.tonic;
  const basePitch=name=>SEMITONES[STEPS.indexOf(name[0])]+(name.endsWith('#')?1:name.endsWith('b')?-1:0);
  let letters=STEPS.indexOf(tonic[0])-STEPS.indexOf(source[0]),semitones=basePitch(tonic)-basePitch(source);
  if(semitones>6){letters-=7;semitones-=12;}
  if(semitones< -6){letters+=7;semitones+=12;}
  const notes=lesson.notes.map(({finger,...note})=>{
    const midi=note.pitch.midi+semitones;
    const index=note.pitch.octave*7+STEPS.indexOf(note.pitch.step)+letters;
    const step=STEPS[(index%7+7)%7],octave=Math.floor(index/7);
    const alter=midi-pitchMidi({step,alter:0,octave});
    return {...note,pitch:{step,alter,octave,midi}};
  });
  // The authored fingerings apply to the original key.
  return {...lesson,key:{...lesson.key,tonic,fifths},notes};
}

export function lessonGroups(notes,{withHolds=false}={}) {
  const byTick=new Map();
  for(const note of notes){
    if(!byTick.has(note.startTick))byTick.set(note.startTick,[]);
    byTick.get(note.startTick).push(note);
  }
  return [...byTick].sort(([a],[b])=>a-b).map(([tick,attacks])=>({
    tick,notes:attacks,held:withHolds?notes.filter(note=>note.startTick<tick&&note.startTick+note.durationTick>tick):[]
  }));
}

export function barLength(lesson) {
  return lesson.ppq*4*lesson.meter.numerator/lesson.meter.denominator;
}

export function barCount(lesson) {
  return Math.ceil(Math.max(...lesson.notes.map(note=>note.startTick+note.durationTick))/barLength(lesson));
}

export function lessonVariant(lesson,{hand=lesson.handMode,bar=0,octaves=0}={}) {
  const variants=[];
  let notes=lesson.notes;
  if(hand!==lesson.handMode){
    notes=notes.filter(note=>note.hand===hand);
    variants.push(hand.toLowerCase());
  }
  if(bar){
    const size=barLength(lesson),start=(bar-1)*size,end=start+size;
    notes=notes.flatMap(note=>{
      const from=Math.max(start,note.startTick),to=Math.min(end,note.startTick+note.durationTick);
      return from<to?[{...note,startTick:from-start,durationTick:to-from}]:[];
    });
    variants.push('bar'+bar);
  }
  if(octaves){
    notes=notes.map(note=>({...note,pitch:{...note.pitch,octave:note.pitch.octave+octaves,midi:note.pitch.midi+octaves*12}}));
    variants.push('oct'+(octaves<0?'m'+(-octaves):octaves));
  }
  return variants.length?{...lesson,notes,handMode:hand,variant:variants.join('-')}:lesson;
}

export function lessonRange({notes}) {
  const pitches=notes.map(note=>note.pitch.midi);
  return {min:Math.min(...pitches),max:Math.max(...pitches)};
}

export function fittingOctave(required,observed) {
  const low=Math.ceil((observed.min-required.min)/12),high=Math.floor((observed.max-required.max)/12);
  if(low>high)return null;
  return Math.min(high,Math.max(low,0));
}

export function lessonClef(notes) {
  const mean=notes.reduce((sum,note)=>sum+note.pitch.midi,0)/notes.length;
  return mean<60?'bass':'treble';
}

export function demoSchedule({notes,bpm,ppq,loop=false},rate,part,transpose) {
  if(!Array.isArray(notes)||!notes.length||notes.length>128||ppq!==480||
      !Number.isInteger(bpm)||bpm<40||bpm>240||typeof loop!=='boolean')throw Error('Invalid Music Lab demo');
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
  return {events,length:frames(length),duration:length*rate*60/(bpm*ppq),bpm,ticks:length*2,loop};
}
