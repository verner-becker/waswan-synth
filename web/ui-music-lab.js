// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {barCount,fittingOctave,lessonClef,lessonGroups,lessonKeys,lessonRange,lessonVariant,midiPitchLabel,pitchLabel,tonicName,transposeLesson} from './music-lab-model.js';
import {LAB_LESSONS,lessonChordSymbol} from './music-lab-catalog.js';
import {loadNotation,renderLessonScore} from './ui-music-lab-score.js';
import {MusicLabMidiPractice} from './ui-music-lab-practice.js';
import {MusicLabRange} from './ui-music-lab-range.js';
import {backingPlan,harmonyAt,observedHarmony} from './music-lab-backing.js';
import {downloadPracticeProject} from './music-lab-project.js';
const TRACKS=[
  ['all','Todas'],
  ['melody','Melody Lab'],
  ['harmony','Harmony Lab'],
  ['technique','Technique & Expression']
];
const HANDS={RH:'Mão direita',LH:'Mão esquerda',BOTH:'Duas mãos',FREE:'Prática livre'};
const HAND_SIGNS={RH:'MD',LH:'ME'};
const LEVELS=[['all','Todos'],['foundation','Fundamentos'],['application','Aplicação'],['coordination','Coordenação']];
const KEYS=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const MESSAGES={
  'audio-unavailable':'Inicie ou retome o áudio do Synth para ouvir a prévia.',
  busy:'O instrumento está em uso pelo Studio, pela DAW ou pelo transporte do Synth.',
  'no-part':'A prévia precisa de uma parte POLY ou DUAL audível, fora das camadas ao vivo.',
  'no-voices':'As vozes do instrumento estão ocupadas. Tente novamente depois de soltar as notas.',
  interrupted:'Prévia interrompida pelo instrumento.',
  'instrument-unavailable':'O timbre da prévia ficou indisponível.',
  'invalid-demo':'Não foi possível preparar a prévia desta lição.'
};

function selectField(label,options,value,onChange) {
  const field=el('label','ww-lab-field',label),select=el('select');
  select.setAttribute('aria-label',label);
  for(const [key,text] of options)select.add(new Option(text,key));
  select.value=value;
  select.onchange=()=>onChange(select.value);
  field.append(select);
  return {field,select};
}

function checkField(label,checked,onChange) {
  const field=el('label','ww-lab-check'),input=el('input');
  input.type='checkbox';
  input.checked=checked;
  input.onchange=()=>onChange(input.checked);
  field.append(input,document.createTextNode(label));
  return {field,input};
}

export class MusicLab {
  constructor({bridge,startAudio,openSettings,inputConflict}) {
    Object.assign(this,{bridge,startAudio,openSettings,track:'all',tonic:'C',bpm:60,showFingers:true,entry:LAB_LESSONS[0],
      hand:'RH',bar:0,octaves:0});
    const css=el('link');
    css.rel='stylesheet';
    css.href=new URL('./ui-music-lab.css',import.meta.url).href;
    document.head.append(css);
    this.node=el('section','ww-lab');
    this.node.lang='pt-BR';
    this.node.translate=false;
    const header=el('header','ww-lab-heading');
    const title=el('h1','','Music Lab');
    this.audioStatus=el('span','ww-chip');
    this.midiStatus=el('span','ww-chip');
    this.audioAction=action('Iniciar áudio',startAudio);
    this.midiAction=action('Configurar MIDI',openSettings);
    const system=el('div','ww-lab-system');
    system.append(this.audioStatus,this.audioAction,this.midiStatus,this.midiAction);
    header.append(title,system);

    const layout=el('div','ww-lab-layout');
    const library=el('aside','ww-panel ww-lab-library');
    const filter=el('div','ww-lab-filters');
    filter.setAttribute('role','group');
    filter.setAttribute('aria-label','Trilhas');
    this.filters=TRACKS.map(([id,label])=>{
      const button=action(label,()=>this.filter(id));
      filter.append(button);
      return {id,button};
    });
    this.list=el('div','ww-lab-lessons');
    const level=selectField('Nível',LEVELS,'all',()=>this.filter(this.track));
    this.level=level.select;
    library.append(el('h2','','Lições'),filter,level.field,this.list);

    const page=el('section','ww-panel ww-lab-lesson');
    this.lessonTitle=el('h2');
    this.meta=el('p','ww-lab-meta');
    this.goal=el('p','ww-lab-goal');
    const controls=el('div','ww-lab-controls');
    const key=selectField('Tonalidade',[],this.tonic,value=>{
      this.tonic=value;
      this.octaves=0;
      this.load();
    });
    this.key=key.select;
    const hand=selectField('Mãos',[['BOTH','Juntas'],['RH','Direita'],['LH','Esquerda']],'BOTH',value=>{
      this.hand=value;
      this.bar=this.octaves=0;
      this.load();
    });
    this.handField=hand;
    const excerpt=selectField('Trecho',[],'0',value=>{
      this.bar=Number(value);
      this.load();
    });
    this.excerpt=excerpt;
    const tempo=selectField('Andamento',[[40,'40 BPM'],[60,'60 BPM'],[72,'72 BPM'],[80,'80 BPM'],[100,'100 BPM']],this.bpm,value=>{
      this.stop();
      this.bpm=Number(value);
    });
    this.tempo=tempo.select;
    this.zoom=selectField('Zoom da pauta',[[100,'100%'],[150,'150%'],[200,'200%']],100,value=>{
      this.score.style.setProperty('--lab-zoom',Number(value)/100);
    });
    this.fingers=checkField('Dedilhado',true,checked=>{this.showFingers=checked;void this.drawScore();this.showPosition();});
    this.loop=checkField('Repetir exemplo',false,()=>this.stop('Prévia parada.'));
    controls.append(key.field,hand.field,excerpt.field,tempo.field,this.zoom.field,this.fingers.field);
    this.score=el('div','ww-lab-score');
    this.score.tabIndex=0;
    this.score.setAttribute('role','region');
    this.score.setAttribute('aria-label','Partitura');
    this.score.setAttribute('aria-describedby','ww-lab-position');

    const transport=el('div','ww-lab-transport');
    this.listen=action('Ouvir exemplo',()=>this.play(),'ww-primary');
    this.halt=action('Parar',()=>this.stop('Prévia parada.'));
    this.practice=action('Praticar sozinho',()=>{this.mode='practice';this.point(0);this.say('Acompanhe a pauta no seu ritmo.');});
    this.previous=action('Anterior',()=>this.point(this.index-1));
    this.next=action('Avançar',()=>{
      if(this.index+1<this.groups.length)this.point(this.index+1);
      else{this.mode='complete';this.point(-1);this.say('Estudo concluído.');}
    });
    transport.append(this.listen,this.halt,this.practice,this.previous,this.next,this.loop.field);
    this.position=el('p','ww-lab-position');
    this.position.id='ww-lab-position';
    this.keyboard=el('div','ww-lab-keyboard');
    this.keyboard.setAttribute('aria-hidden','true');
    this.instructions=el('p','ww-lab-instructions');
    this.status=el('p','ww-lab-status');
    this.status.setAttribute('role','status');
    this.buildBackingControls();
    this.midiPractice=new MusicLabMidiPractice({
      bridge,conflict:()=>inputConflict()||(this.range.active?'Conclua a calibração para iniciar a prática.':this.rangeReason()),
      autoChannel:()=>this.range.current?.channel??null,onChannel:()=>this.refresh(),
      chordAt:at=>this.backing?.startFrame!=null?observedHarmony(this.backing.plan,this.backing.startFrame,at,this.bridge.getAudio().context):null,
      playTake:take=>this.playTake(take),
      onState:(mode,index)=>{
        this.mode=mode;
        this.point(index);
        this.say('');
        this.refresh();
      },
      onObserved:played=>{this.played=played;this.paintPiano();}
    });
    this.range=new MusicLabRange({bridge,conflict:inputConflict,channel:()=>this.midiPractice.selectedChannel,onChange:()=>this.refresh()});
    this.adapt=action('',()=>{
      if(this.suggestion===null)return;
      this.octaves+=this.suggestion;
      this.load();
    });
    this.restoreRange=action('Voltar à oitava original',()=>{this.octaves=0;this.load();});
    this.range.node.append(this.adapt,this.restoreRange);
    page.append(this.meta,this.lessonTitle,this.goal,controls,this.score,transport,this.range.node,this.backingNode,
      this.midiPractice.controls,this.midiPractice.availability,this.position,this.keyboard,this.status,this.midiPractice.feedback,
      this.midiPractice.details,this.instructions,this.midiPractice.takesNode,this.midiPractice.history);
    layout.append(library,page);
    this.node.append(header,layout);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden)this.deactivate('Prática pausada enquanto a aba está em segundo plano.');
    });
    this.filter('all');
    this.load();
    this.refresh();
  }

  filter(track) {
    this.track=track;
    for(const {id,button} of this.filters)button.setAttribute('aria-pressed',String(id===track));
    const inTrack=LAB_LESSONS.filter(({data})=>track==='all'||data.track===track||track==='technique'&&data.tags.includes('fingering'));
    for(const option of this.level.options)option.disabled=option.value!=='all'&&!inTrack.some(entry=>entry.level===option.value);
    if(this.level.selectedOptions[0]?.disabled)this.level.value='all';
    const entries=inTrack.filter(entry=>this.level.value==='all'||entry.level===this.level.value);
    if(!entries.includes(this.entry)){
      this.selectLesson(entries[0]);
    }
    this.list.replaceChildren(...entries.map(entry=>{
      const button=action('',()=>{
        if(this.entry===entry)return;
        this.selectLesson(entry);
        this.filter(this.track);
        this.list.querySelector('[aria-pressed="true"]')?.focus();
      });
      button.append(el('strong','',entry.label),el('small','',entry.detail));
      button.setAttribute('aria-pressed',String(entry===this.entry));
      return button;
    }));
  }

  selectLesson(entry) {
    this.entry=entry;
    this.tonic=entry.data.key.tonic;
    this.hand=entry.data.handMode;
    this.bar=this.octaves=0;
    if(entry.backing){
      this.bpm=entry.data.tempoBpm;
      this.tempo.value=String(this.bpm);
    }
    this.load();
  }

  load() {
    this.stop();
    const data=this.entry.data,keys=lessonKeys(data);
    const source=transposeLesson(data,this.tonic),base=lessonVariant(source,{hand:this.hand});
    const bars=barCount(base);
    this.key.replaceChildren(...Object.entries(keys).map(([tonic,v])=>new Option(v.name,tonic)));
    this.key.value=this.tonic;
    this.handField.field.hidden=data.handMode!=='BOTH';
    this.handField.select.value=this.hand;
    this.excerpt.field.hidden=bars<2;
    this.excerpt.select.replaceChildren(new Option('Toda a lição','0'),
      ...Array.from({length:bars},(_,i)=>new Option('Compasso '+(i+1),String(i+1))));
    this.excerpt.select.value=String(this.bar);
    this.lesson=lessonVariant(source,{hand:this.hand,bar:this.bar,octaves:this.octaves});
    this.backingNode.hidden=!this.entry.backing;
    this.saveExercise.hidden=this.lesson.mode==='creative';
    this.needed=lessonRange(this.lesson);
    this.groups=lessonGroups(this.lesson.notes,{withHolds:this.hand==='BOTH'});
    this.played=null;
    this.midiPractice.setLesson(this.lesson,this.groups,()=>this.bpm);
    this.mode='observe';
    this.index=0;
    const {key,handMode,title,instructions,learningGoal}=this.lesson;
    const original=key.tonic===data.key.tonic,root=keys[data.key.tonic].name;
    this.lessonTitle.textContent=original?title:title.includes(root)?title.replace(root,keys[key.tonic].name):title+' · '+tonicName(key.tonic);
    const clef=handMode==='BOTH'?'Pauta dupla':lessonClef(this.lesson.notes)==='bass'?'Clave de fá':'Clave de sol';
    this.meta.textContent=[HAND_SIGNS[handMode]?[HAND_SIGNS[handMode],HANDS[handMode]].join(' · '):HANDS[handMode],
      clef,lessonChordSymbol(this.lesson,this.entry.quality),this.bar?'Compasso '+this.bar:''].filter(Boolean).join('  /  ');
    this.goal.textContent=original?learningGoal:learningGoal.includes(root)?learningGoal.replace(root,keys[key.tonic].name):
      'Acompanhe os intervalos da lição na nova tonalidade.';
    this.instructions.textContent=data.handMode==='BOTH'&&handMode!=='BOTH'?'Toque a mão indicada e ouça sua parte separadamente.':
      original?instructions:'A transposição mantém o ritmo e os intervalos da lição original.';
    this.fingers.input.disabled=!this.lesson.notes.some(note=>note.finger);
    this.fingers.input.checked=!this.fingers.input.disabled&&this.showFingers;
    this.buildKeyboard();
    void this.drawScore();
    this.showPosition();
    this.say('');
    this.refresh();
  }

  async drawScore() {
    const render=Symbol();
    this.render=render;
    this.markScore=null;
    try{
      const flow=await (this.notation??=loadNotation());
      if(this.render!==render)return;
      this.markScore=renderLessonScore(this.score,this.lesson,flow,this.showFingers);
      this.showPosition();
    }catch{
      if(this.render===render)this.score.replaceChildren(el('p','','A partitura está indisponível. Use as notas indicadas abaixo.'));
    }
  }

  buildKeyboard() {
    const pitches=this.lesson.notes.map(n=>n.pitch.midi);
    const low=Math.floor(Math.min(...pitches)/12)*12,high=Math.min(127,Math.ceil(Math.max(...pitches)/12)*12);
    const natural=el('div','ww-lab-white-keys'),black=el('div','ww-lab-black-keys');
    const whites=[];
    this.keys=new Map();
    for(let midi=low;midi<=high;midi++){
      const pitch=KEYS[midi%12],sharp=pitch.length>1;
      const key=el('span','ww-lab-piano-key');
      const label=el('span','ww-lab-key-label',pitch==='C'?'C'+(midi/12-1):'');
      const highlighted=el('span','ww-lab-key-highlight');
      key.append(label,highlighted);
      this.keys.set(midi,{key,highlighted});
      if(sharp){
        key.style.setProperty('--boundary',whites.length);
        black.append(key);
      }else{
        whites.push(key);
        natural.append(key);
      }
    }
    black.style.setProperty('--white-count',whites.length);
    const keys=el('div','ww-lab-piano');
    keys.append(natural,black);
    this.keyboard.replaceChildren(keys);
  }

  point(index) {
    this.index=index;
    this.showPosition();
  }

  paintPiano() {
    const group=this.groups[this.index];
    for(const [midi,{key,highlighted}] of this.keys){
      const attack=group?.notes.find(item=>item.pitch.midi===midi),hold=group?.held.find(item=>item.pitch.midi===midi);
      const note=attack||hold;
      key.classList.toggle('ww-lab-key-current',!!attack);
      key.classList.toggle('ww-lab-key-held',!!hold);
      const hand=this.hand==='BOTH'&&note?HAND_SIGNS[note.hand]+' ':'';
      highlighted.textContent=note?hand+(this.showFingers&&note.finger?note.finger:pitchLabel(note.pitch)):'';
      const played=this.played?.pitch===midi?this.played:null;
      key.classList.toggle('ww-lab-key-played',played?.correct===true);
      key.classList.toggle('ww-lab-key-outside',played?.correct===false);
      key.classList.toggle('ww-lab-key-observed',played?.correct===null);
    }
  }

  showPosition() {
    const group=this.groups[this.index];
    this.markScore?.(group?.tick,group?.held);
    this.paintPiano();
    if(group){
      const notes=group.notes.map(({pitch,finger,hand})=>(this.hand==='BOTH'?HAND_SIGNS[hand]+' ':'')+pitchLabel(pitch)+(finger&&this.showFingers?' · dedo '+finger:''));
      const holds=group.held.length?'  /  Mantenha '+group.held.map(note=>HAND_SIGNS[note.hand]+' '+pitchLabel(note.pitch)).join(' + '):'';
      this.position.textContent=`${this.index+1} de ${this.groups.length}  /  ${notes.join('  +  ')}`+holds;
      const cursor=this.score.querySelector('.ww-lab-score-cursor');
      if(cursor){
        const bounds=this.score.getBoundingClientRect(),target=cursor.getBoundingClientRect();
        if(target.right>bounds.right-16)this.score.scrollLeft+=target.right-bounds.right+25;
        else if(target.left<bounds.left+16)this.score.scrollLeft+=target.left-bounds.left-25;
      }
    }else this.position.textContent=HANDS[this.lesson.handMode];
    this.practice.disabled=!!this.token||this.midiPractice.hasAttempt;
    this.previous.hidden=this.next.hidden=this.mode!=='practice';
    this.previous.disabled=this.index<=0;
    this.next.textContent=this.index===this.groups.length-1?'Concluir':'Avançar';
  }

  say(message) {
    if(this.status.textContent!==message)this.status.textContent=message;
    if(this.node.dataset.labState!==this.mode)this.node.dataset.labState=this.mode;
  }

  play() {
    if(this.midiPractice.hasAttempt)return;
    if(this.bridge.isDawBusy?.()||this.bridge.isStudioBusy?.()){
      this.say(MESSAGES.busy);
      return;
    }
    if(this.bridge.getAudio().context?.state!=='running')return;
    this.mode='demonstrate';
    this.point(0);
    this.say('Preparando exemplo…');
    this.sendPlayback('example',{ppq:this.lesson.ppq,bpm:this.bpm,loop:this.loop.input.checked,
      notes:this.lesson.notes.map(({pitch:{midi},startTick,durationTick})=>({midi,startTick,durationTick}))});
    this.showPosition();
  }

  sendPlayback(kind,plan) {
    this.playbackKind=kind;
    this.token=crypto.randomUUID();
    this.bridge.send({t:'music-lab-start',token:this.token,...plan});
    this.refresh();
  }

  buildBackingControls() {
    const style=selectField('Acompanhamento',[['click','Metrônomo'],['bass','Baixo e pulso'],
      ['harmony','Baixo, acordes e pulso']],'bass',()=>this.stop());
    this.backingStyle=style.select;
    this.backingPlay=action('Tocar acompanhamento',()=>void this.playBacking());
    this.backingStop=action('Parar acompanhamento',()=>this.stop());
    this.backingMute=action('Silenciar acompanhamento',()=>{
      this.backingMuted=!this.backingMuted;
      this.backingMute.textContent=this.backingMuted?'Restaurar acompanhamento':'Silenciar acompanhamento';
      this.backingMute.setAttribute('aria-pressed',String(!!this.backingMuted));
      this.updateBackingLevel();
    });
    this.backingMute.setAttribute('aria-pressed','false');
    this.backingLevel=el('input');
    this.backingLevel.type='range';
    Object.assign(this.backingLevel,{min:0,max:100,step:1,value:65});
    this.backingLevel.oninput=()=>this.updateBackingLevel();
    const label=el('label','ww-lab-field','Nível');
    this.backingLevel.setAttribute('aria-label','Nível do acompanhamento');
    label.append(this.backingLevel);
    this.saveExercise=action('Salvar exercício para DAW',async()=>{
      try{
        const notes=notes=>notes.map(({pitch:{midi},startTick,durationTick})=>({midi,startTick,durationTick}));
        const sources=['LH','RH'].map(hand=>({label:HANDS[hand],notes:notes(this.lesson.notes.filter(note=>note.hand===hand))}));
        await downloadPracticeProject({name:'Music Lab — '+this.lessonTitle.textContent,bpm:this.bpm,sources});
        this.say('Cópia em formato .wsproj preparada para a DAW.');
      }catch{this.say('Não foi possível salvar a cópia para DAW.');}
    });
    this.currentChord=el('span','ww-lab-backing-chord');
    this.backingNode=el('div','ww-lab-backing');
    this.backingNode.append(style.field,this.backingPlay,this.backingStop,label,this.backingMute,this.currentChord,this.saveExercise);
  }

  updateBackingLevel() {
    if(this.token&&this.backing)this.bridge.send({t:'music-lab-level',token:this.token,level:this.backingMuted?0:Number(this.backingLevel.value)});
  }

  async playBacking() {
    if(this.token||this.pendingBacking||!this.entry.backing||this.backingPlay.disabled)return;
    const pending=Symbol();
    this.pendingBacking=pending;
    const {context,node,gain}=this.bridge.getAudio();
    this.currentChord.textContent='Preparando acompanhamento…';
    this.refresh();
    try{
      if(this.clickContext!==context){
        await context.audioWorklet.addModule(new URL('./daw-click.js',import.meta.url));
        if(this.pendingBacking!==pending||context!==this.bridge.getAudio().context)return;
        const click=new AudioWorkletNode(context,'waswan-daw-click',{numberOfInputs:1,outputChannelCount:[2],processorOptions:{musicLab:true}});
        node.connect(click,0);
        click.connect(gain);
        this.clickContext=context;
      }
      if(this.pendingBacking!==pending||context.state!=='running'||this.bridge.isDawBusy?.()||this.bridge.isStudioBusy?.())return;
      const plan=backingPlan({form:this.entry.backing,tonic:this.tonic,style:this.backingStyle.value,bpm:this.bpm,bar:this.bar});
      const {harmony,...schedule}=plan;
      this.pendingBacking=null;
      this.backing={plan};
      this.sendPlayback('backing',{...schedule,backing:true,level:this.backingMuted?0:Number(this.backingLevel.value)});
    }catch{
      if(this.pendingBacking===pending)this.say('Não foi possível preparar o acompanhamento.');
    }finally{
      if(this.pendingBacking===pending){
        this.pendingBacking=null;
        this.currentChord.textContent='';
        this.refresh();
      }
    }
  }

  playTake(take) {
    if(this.midiPractice.hasAttempt||this.range.active||this.bridge.getAudio().context?.state!=='running')return;
    this.stop();
    this.say('Ouvindo a tomada MIDI.');
    this.sendPlayback('take',{notes:take.notes,bpm:take.bpm,ppq:480});
  }

  stop(message='') {
    if(this.pendingBacking){
      this.pendingBacking=null;
      this.currentChord.textContent='';
      this.refresh();
    }
    if(!this.token)return;
    const kind=this.playbackKind;
    this.bridge.send({t:'music-lab-stop',token:this.token});
    this.token=null;
    this.backing=null;
    this.currentChord.textContent='';
    if(kind==='example'){
      this.mode='observe';
      this.point(-1);
    }
    this.say(message);
    this.refresh();
  }

  deactivate(reason='Prática pausada ao sair do Music Lab.') {
    this.stop('Prévia parada.');
    this.midiPractice.pause(reason);
    this.range.cancel();
  }

  rangeReason() {
    if(this.lesson.mode==='creative')return '';
    const observed=this.range.current;
    if(!observed)return this.hand==='BOTH'?'Calibre o alcance antes de praticar com as duas mãos.':'';
    if(fittingOctave(this.needed,observed)===0)return '';
    const required=midiPitchLabel(this.needed.min)+'–'+midiPitchLabel(this.needed.max);
    return `O trecho exige ${required}. ${this.hand==='BOTH'?'Ajuste a oitava ou estude cada mão separadamente.':'Ajuste a oitava ou recalibre o teclado.'}`;
  }

  receive(message) {
    if(message.t==='ready'||message.t==='error'){
      if(message.t==='error')this.stop();
      this.refresh();
      return;
    }
    if(message.t!=='music-lab-state'||message.token!==this.token)return;
    if(this.playbackKind==='backing'){
      if(message.playing){
        this.backing.startFrame=message.startFrame;
        const {plan}=this.backing;
        const tick=message.frame*plan.bpm*plan.ppq/(this.bridge.getAudio().context.sampleRate*60);
        const chord=harmonyAt(plan,tick);
        const label=chord?`Acorde ${chord.label} · compasso ${Math.floor(tick/1920)+1}`:'';
        if(this.currentChord.textContent!==label)this.currentChord.textContent=label;
      }else{
        this.token=null;
        this.backing=null;
        this.currentChord.textContent='';
        this.say(MESSAGES[message.reason]||'Acompanhamento encerrado.');
        this.refresh();
      }
      return;
    }
    if(this.playbackKind==='take'){
      if(!message.playing){
        this.token=null;
        this.say(message.reason==='ended'?'Escuta concluída.':MESSAGES[message.reason]||'Escuta encerrada.');
        this.refresh();
      }
      return;
    }
    if(message.playing){
      this.say(`Exemplo em reprodução · Parte ${'ABCD'[message.part]}`);
      const tick=message.frame*this.lesson.ppq*this.bpm/(this.bridge.getAudio().context.sampleRate*60);
      const index=this.groups.findLastIndex(group=>group.tick<=tick&&group.notes.some(n=>n.startTick+n.durationTick>tick));
      if(this.index!==index)this.point(index);
    }else{
      this.token=null;
      this.mode=message.reason==='ended'?'complete':'observe';
      this.point(-1);
      this.say(message.reason==='ended'?'Exemplo concluído.':MESSAGES[message.reason]||'Prévia parada.');
      this.refresh();
    }
  }

  refresh() {
    const {context,node,muted}=this.bridge.getAudio();
    const hostRunning=this.bridge.isRunning();
    const running=!!node&&context?.state==='running'&&hostRunning;
    const silent=hostRunning&&!node;
    const audio=running?(muted?'Saída silenciada':'Áudio ativo'):
      silent?'Áudio indisponível':context?.state==='suspended'?'Áudio pausado':'Áudio parado';
    const connected=!!this.bridge.midi.input;
    const midi=connected?'MIDI conectado':'Sem MIDI · leitura e exemplo disponíveis';
    if(this.audioStatus.textContent!==audio)this.audioStatus.textContent=audio;
    if(this.midiStatus.textContent!==midi)this.midiStatus.textContent=midi;
    const hideStart=running||silent;
    if(this.audioAction.hidden!==hideStart)this.audioAction.hidden=hideStart;
    const audioAction=context?.state==='suspended'?'Retomar áudio':'Iniciar áudio';
    if(this.audioAction.textContent!==audioAction)this.audioAction.textContent=audioAction;
    this.range.refresh(!!this.token||!!this.pendingBacking||this.midiPractice.state==='listening');
    const range=this.range.current;
    this.suggestion=range?fittingOctave(this.needed,range):null;
    const canAdapt=this.suggestion!==null&&this.suggestion!==0&&!this.range.active;
    this.adapt.hidden=!canAdapt;
    if(canAdapt){
      const size=Math.abs(this.suggestion),verb=this.suggestion>0?'Subir':'Descer';
      const label=`${verb} ${size} ${size===1?'oitava':'oitavas'}`;
      if(this.adapt.textContent!==label)this.adapt.textContent=label;
    }
    this.restoreRange.hidden=!this.octaves||this.range.active;
    const disabled=!running||!!this.token||!!this.pendingBacking||this.midiPractice.hasAttempt||this.range.active;
    if(this.listen.disabled!==disabled)this.listen.disabled=disabled;
    this.tempo.disabled=this.midiPractice.hasAttempt;
    this.halt.hidden=!this.token||this.playbackKind==='backing';
    const backing=!!this.backing||!!this.pendingBacking;
    this.backingPlay.hidden=backing;
    this.backingStop.hidden=!backing;
    this.backingPlay.disabled=!running||!!this.token||this.range.active||!!this.bridge.isDawBusy?.()||!!this.bridge.isStudioBusy?.();
    this.backingStyle.disabled=backing;
    this.midiPractice.refresh(!!this.token&&this.playbackKind!=='backing'||!!this.pendingBacking);
    this.midiPractice.channel.disabled=this.range.active||this.midiPractice.state==='listening';
    this.loop.input.disabled=this.midiPractice.hasAttempt||this.range.active;
  }
}
