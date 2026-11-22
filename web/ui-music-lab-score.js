// SPDX-License-Identifier: GPL-3.0-only
import {lessonClef,lessonGroups} from './music-lab-model.js';

export async function loadNotation() {
  await import('./vendor/vexflow/vexflow-bravura.js');
  return globalThis.Vex.Flow;
}

export function renderLessonScore(node,lesson,flow,showFingers) {
  const {Renderer,Stave,StaveNote,Voice,Formatter,Accidental,FretHandFinger,Modifier,Barline}=flow;
  const {numerator,denominator}=lesson.meter;
  const barTicks=lesson.ppq*4*numerator/denominator;
  const end=Math.max(...lesson.notes.map(n=>n.startTick+n.durationTick));
  const bars=Math.ceil(end/barTicks);
  const clef=lessonClef(lesson.notes);
  const events=lessonGroups(lesson.notes);
  const durations=new Map([[4*lesson.ppq,'w'],[2*lesson.ppq,'h'],[lesson.ppq,'q'],[lesson.ppq/2,'8'],[lesson.ppq/4,'16']]);
  const positions=[];
  const height=156,margin=16,first=bars===1?346:258,other=174;
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
  const restKey=clef==='bass'?'d/3':'b/4';
  for(let bar=0;bar<bars;bar++){
    const start=bar*barTicks;
    const x=margin+(bar===0?0:first+(bar-1)*other);
    const stave=new Stave(x,28,bar===0?first:other).setContext(ctx);
    if(bar===0)stave.addClef(clef).addKeySignature(lesson.key.tonic).addTimeSignature(numerator+'/'+denominator);
    if(bar===bars-1)stave.setEndBarType(Barline.type.END);
    stave.draw();
    const notes=[];
    const addRests=ticks=>{
      for(const [size,duration] of durations)while(ticks>=size){
        notes.push(new StaveNote({clef,keys:[restKey],duration:duration+'r'}));
        ticks-=size;
      }
      if(ticks)throw Error('Unsupported rest duration');
    };
    let cursor=start;
    for(const group of events.filter(group=>group.tick>=start&&group.tick<start+barTicks)){
      addRests(group.tick-cursor);
      const ticks=group.notes[0].durationTick,duration=durations.get(ticks);
      if(!duration||group.tick<cursor||group.tick+ticks>start+barTicks||group.notes.some(n=>n.durationTick!==ticks))
        throw Error('Unsupported notation rhythm');
      const keys=group.notes.map(({pitch:p})=>p.step.toLowerCase()+(p.alter<0?'b'.repeat(-p.alter):'#'.repeat(p.alter))+'/'+p.octave);
      const note=new StaveNote({clef,keys,duration,auto_stem:true});
      if(showFingers)group.notes.forEach(({finger},index)=>{
        if(finger){
          const position=group.notes.length>1?Modifier.Position.LEFT:clef==='bass'?Modifier.Position.BELOW:Modifier.Position.ABOVE;
          note.addModifier(new FretHandFinger(String(finger)).setPosition(position),index);
        }
      });
      notes.push(note);
      positions.push({group,note});
      cursor=group.tick+ticks;
    }
    addRests(start+barTicks-cursor);
    const voice=new Voice({num_beats:numerator,beat_value:denominator}).addTickables(notes);
    Accidental.applyAccidentals([voice],lesson.key.tonic);
    new Formatter().joinVoices([voice]).formatToStave([voice],stave);
    voice.draw(ctx,stave);
  }
  const cursor=document.createElementNS('http://www.w3.org/2000/svg','rect');
  cursor.setAttribute('y','37');
  cursor.setAttribute('width','36');
  cursor.setAttribute('height','106');
  cursor.setAttribute('rx','5');
  cursor.classList.add('ww-lab-score-cursor');
  cursor.style.display='none';
  svg.prepend(cursor);
  node.replaceChildren(drawing);
  const marks=positions.map(({group,note})=>{
    const mark=note.getSVGElement();
    mark.dataset.labTick=group.tick;
    mark.dataset.midi=group.notes.map(n=>n.pitch.midi).join(' ');
    return {mark,tick:group.tick,x:note.getAbsoluteX()-7};
  });
  return tick=>{
    for(const {mark,tick:onset} of marks)mark.classList.toggle('ww-lab-note-current',onset===tick);
    const active=marks.find(mark=>mark.tick===tick);
    cursor.style.display=active?'':'none';
    if(active)cursor.setAttribute('x',active.x);
  };
}
