// SPDX-License-Identifier: GPL-3.0-only
import {barCount,barLength,lessonClef,lessonGroups,notationKey} from './music-lab-model.js';

export async function loadNotation() {
  await import('./vendor/vexflow/vexflow-bravura.js');
  return globalThis.Vex.Flow;
}

function barVoice(flow,{clef,events,hand},{start,length,lesson,showFingers,positions,durations}) {
  const {StaveNote,Voice,Accidental,FretHandFinger,Modifier}=flow;
  const {numerator,denominator}=lesson.meter;
  const restKey=clef==='bass'?'d/3':'b/4';
  const notes=[];
  const addRests=ticks=>{
    for(const [size,duration] of durations)while(ticks>=size){
      notes.push(new StaveNote({clef,keys:[restKey],duration:duration+'r'}));
      ticks-=size;
    }
    if(ticks)throw Error('Unsupported rest duration');
  };
  let cursor=start;
  for(const group of events.filter(group=>group.tick>=start&&group.tick<start+length)){
    addRests(group.tick-cursor);
    const ticks=group.notes[0].durationTick,duration=durations.get(ticks);
    if(!duration||group.tick<cursor||group.tick+ticks>start+length||group.notes.some(n=>n.durationTick!==ticks))
      throw Error('Unsupported notation rhythm');
    const keys=group.notes.map(({pitch:p})=>p.step.toLowerCase()+(p.alter<0?'b'.repeat(-p.alter):'#'.repeat(p.alter))+'/'+p.octave);
    const note=new StaveNote({clef,keys,duration,auto_stem:true});
    if(showFingers)group.notes.forEach(({finger},index)=>{
      if(finger){
        const position=group.notes.length>1?Modifier.Position.LEFT:hand==='LH'?Modifier.Position.BELOW:Modifier.Position.ABOVE;
        note.addModifier(new FretHandFinger(String(finger)).setPosition(position),index);
      }
    });
    notes.push(note);
    positions.push({group,note,hand});
    cursor=group.tick+ticks;
  }
  addRests(start+length-cursor);
  const voice=new Voice({num_beats:numerator,beat_value:denominator}).addTickables(notes);
  Accidental.applyAccidentals([voice],notationKey(lesson.key));
  return voice;
}

export function renderLessonScore(node,lesson,flow,showFingers) {
  const {Renderer,Stave,StaveConnector,Formatter,Barline}=flow;
  const {numerator,denominator}=lesson.meter;
  const length=barLength(lesson),bars=barCount(lesson);
  const both=lesson.handMode==='BOTH';
  const staffs=(both?['RH','LH']:[lesson.handMode]).map(hand=>{
    const notes=both?lesson.notes.filter(note=>note.hand===hand):lesson.notes;
    return {hand,clef:lessonClef(notes),events:lessonGroups(notes)};
  });
  const durations=new Map([[4*lesson.ppq,'w'],[2*lesson.ppq,'h'],[lesson.ppq,'q'],[lesson.ppq/2,'8'],[lesson.ppq/4,'16']]);
  const positions=[];
  const height=both?251:156,margin=both?28:16,first=(bars===1?346:258)+Math.max(0,Math.abs(lesson.key.fifths)-3)*9,other=174;
  const width=margin*2+first+(bars-1)*other;
  const drawing=document.createElement('div');
  drawing.className='ww-lab-engraving';
  drawing.style.setProperty('--lab-score-width',width+'px');
  const renderer=new Renderer(drawing,Renderer.Backends.SVG);
  renderer.resize(width,height);
  const ctx=renderer.getContext();
  ctx.setViewBox(0,0,width,height);
  const svg=drawing.querySelector('svg');
  svg.style.removeProperty('width');
  svg.style.removeProperty('height');
  svg.setAttribute('aria-hidden','true');
  for(let bar=0;bar<bars;bar++){
    const x=margin+(bar===0?0:first+(bar-1)*other);
    const staves=staffs.map(({clef},row)=>{
      const y=both?16+112*row:28;
      const stave=new Stave(x,y,bar===0?first:other).setContext(ctx);
      if(bar===0)stave.addClef(clef).addKeySignature(notationKey(lesson.key)).addTimeSignature(numerator+'/'+denominator);
      if(bar===bars-1)stave.setEndBarType(Barline.type.END);
      return stave;
    });
    if(both)Stave.formatBegModifiers(staves);
    for(const stave of staves)stave.draw();
    if(both){
      const connect=type=>new StaveConnector(...staves).setType(type).setContext(ctx).draw();
      if(bar===0){connect('brace');connect('singleLeft');}
      connect(bar===bars-1?'boldDoubleRight':'singleRight');
    }
    const voices=staffs.map(staff=>barVoice(flow,staff,{start:bar*length,length,lesson,showFingers,positions,durations}));
    const formatter=new Formatter();
    for(const voice of voices)formatter.joinVoices([voice]);
    formatter.formatToStave(voices,staves[0]);
    voices.forEach((voice,index)=>voice.draw(ctx,staves[index]));
  }
  const cursor=document.createElementNS('http://www.w3.org/2000/svg','rect');
  cursor.setAttribute('y',both?'26':'37');
  cursor.setAttribute('width','36');
  cursor.setAttribute('height',both?'209':'106');
  cursor.setAttribute('rx','5');
  cursor.classList.add('ww-lab-score-cursor');
  cursor.style.display='none';
  svg.prepend(cursor);
  node.replaceChildren(drawing);
  const marks=positions.map(({group,note,hand})=>{
    const mark=note.getSVGElement();
    mark.dataset.labTick=group.tick;
    mark.dataset.midi=group.notes.map(n=>n.pitch.midi).join(' ');
    mark.dataset.hand=hand;
    mark.dataset.duration=group.notes[0].durationTick;
    mark.dataset.onsetX=note.getAbsoluteX();
    return {mark,group,x:note.getAbsoluteX()-7};
  });
  return (tick,held=[])=>{
    for(const {mark,group} of marks){
      mark.classList.toggle('ww-lab-note-current',group.tick===tick);
      mark.classList.toggle('ww-lab-note-sustained',held.some(note=>group.notes.includes(note)));
    }
    const active=marks.find(({group})=>group.tick===tick);
    cursor.style.display=active?'':'none';
    if(active)cursor.setAttribute('x',active.x);
  };
}
