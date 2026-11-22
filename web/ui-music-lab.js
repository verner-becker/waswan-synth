// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {LAB_KEYS,lessonClef,lessonGroups,pitchLabel,transposeLesson} from './music-lab-model.js';
import {loadNotation,renderLessonScore} from './ui-music-lab-score.js';
import right from './music-lab/scale-c-major-rh-1oct.json' with {type:'json'};
import left from './music-lab/scale-c-major-lh-1oct.json' with {type:'json'};
import chord from './music-lab/chord-c-major-rh.json' with {type:'json'};

const LESSONS=[
  {data:right,label:'Escala de Dó maior',detail:'Mão direita · 1 oitava'},
  {data:left,label:'Escala de Dó maior',detail:'Mão esquerda · 1 oitava'},
  {data:chord,label:'Tríade de Dó maior',detail:'Posição fundamental · mão direita'}
];
const TRACKS=[
  ['all','Todas'],
  ['melody','Melody Lab'],
  ['harmony','Harmony Lab'],
  ['technique','Technique & Expression']
];
const HANDS={RH:'Mão direita',LH:'Mão esquerda'};
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
  constructor({bridge,startAudio,openSettings}) {
    Object.assign(this,{bridge,startAudio,openSettings,track:'all',tonic:'C',bpm:60,showFingers:true,entry:LESSONS[0]});
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
    library.append(el('h2','','Lições'),filter,this.list);

    const page=el('section','ww-panel ww-lab-lesson');
    this.lessonTitle=el('h2');
    this.meta=el('p','ww-lab-meta');
    this.goal=el('p','ww-lab-goal');
    const controls=el('div','ww-lab-controls');
    const key=selectField('Tonalidade',Object.entries(LAB_KEYS).map(([id,v])=>[id,v.name]),this.tonic,value=>{
      this.stop();
      this.tonic=value;
      this.load();
    });
    this.key=key.select;
    const tempo=selectField('Andamento',[[40,'40 BPM'],[60,'60 BPM'],[80,'80 BPM'],[100,'100 BPM']],this.bpm,value=>{
      this.stop();
      this.bpm=Number(value);
    });
    this.zoom=selectField('Zoom da pauta',[[100,'100%'],[150,'150%'],[200,'200%']],100,value=>{
      this.score.style.setProperty('--lab-zoom',Number(value)/100);
    });
    this.fingers=checkField('Dedilhado',true,checked=>{this.showFingers=checked;void this.drawScore();this.showPosition();});
    controls.append(key.field,tempo.field,this.zoom.field,this.fingers.field);
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
    transport.append(this.listen,this.halt,this.practice,this.previous,this.next);
    this.position=el('p','ww-lab-position');
    this.position.id='ww-lab-position';
    this.keyboard=el('div','ww-lab-keyboard');
    this.keyboard.setAttribute('aria-hidden','true');
    this.instructions=el('p','ww-lab-instructions');
    this.status=el('p','ww-lab-status');
    this.status.setAttribute('role','status');
    page.append(this.meta,this.lessonTitle,this.goal,controls,this.score,transport,this.position,this.keyboard,this.status,this.instructions);
    layout.append(library,page);
    this.node.append(header,layout);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden)this.stop('Prévia parada.');
    });
    this.filter('all');
    this.load();
    this.refresh();
  }

  filter(track) {
    this.track=track;
    for(const {id,button} of this.filters)button.setAttribute('aria-pressed',String(id===track));
    const entries=LESSONS.filter(({data})=>track==='all'||data.track===track||track==='technique'&&data.tags.includes('fingering'));
    if(!entries.includes(this.entry)){
      this.entry=entries[0];
      this.load();
    }
    this.list.replaceChildren(...entries.map(entry=>{
      const button=action('',()=>{
        if(this.entry===entry)return;
        this.entry=entry;
        this.load();
        this.filter(this.track);
        this.list.querySelector('[aria-pressed="true"]')?.focus();
      });
      button.append(el('strong','',entry.label),el('small','',entry.detail));
      button.setAttribute('aria-pressed',String(entry===this.entry));
      return button;
    }));
  }

  load() {
    this.stop();
    this.lesson=transposeLesson(this.entry.data,this.tonic);
    this.groups=lessonGroups(this.lesson.notes);
    this.mode='observe';
    this.index=0;
    const {key,handMode,title,instructions,learningGoal}=this.lesson;
    this.lessonTitle.textContent=key.tonic==='C'?title:this.entry.label.replace('Dó maior',LAB_KEYS[key.tonic].name);
    this.meta.textContent=[handMode==='LH'?'ME · Mão esquerda':'MD · Mão direita',lessonClef(this.lesson.notes)==='bass'?'Clave de fá':'Clave de sol'].join('  /  ');
    this.goal.textContent=key.tonic==='C'?learningGoal:learningGoal.replace('Dó maior',LAB_KEYS[key.tonic].name);
    this.instructions.textContent=key.tonic==='C'?instructions:'A transposição mantém o ritmo e os intervalos da lição original.';
    this.fingers.input.disabled=key.tonic!=='C';
    this.fingers.input.checked=key.tonic==='C'&&this.showFingers;
    this.buildKeyboard();
    void this.drawScore();
    this.showPosition();
    this.say('');
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
    const low=Math.floor(Math.min(...pitches)/12)*12,high=Math.ceil(Math.max(...pitches)/12)*12;
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

  showPosition() {
    const group=this.groups[this.index];
    this.markScore?.(group?.tick);
    for(const [midi,{key,highlighted}] of this.keys){
      const note=group?.notes.find(item=>item.pitch.midi===midi);
      key.classList.toggle('ww-lab-key-current',!!note);
      highlighted.textContent=note?(this.showFingers&&note.finger?note.finger:pitchLabel(note.pitch)):'';
    }
    if(group){
      const notes=group.notes.map(({pitch,finger})=>pitchLabel(pitch)+(finger&&this.showFingers?' · dedo '+finger:''));
      this.position.textContent=`${this.index+1} de ${this.groups.length}  /  ${notes.join('  +  ')}`;
      const cursor=this.score.querySelector('.ww-lab-score-cursor');
      if(cursor){
        const bounds=this.score.getBoundingClientRect(),target=cursor.getBoundingClientRect();
        if(target.right>bounds.right-16)this.score.scrollLeft+=target.right-bounds.right+25;
        else if(target.left<bounds.left+16)this.score.scrollLeft+=target.left-bounds.left-25;
      }
    }else this.position.textContent=HANDS[this.lesson.handMode];
    this.practice.disabled=!!this.token;
    this.previous.hidden=this.next.hidden=this.mode!=='practice';
    this.previous.disabled=this.index<=0;
    this.next.textContent=this.index===this.groups.length-1?'Concluir':'Avançar';
  }

  say(message) {
    if(this.status.textContent!==message)this.status.textContent=message;
    if(this.node.dataset.labState!==this.mode)this.node.dataset.labState=this.mode;
  }

  play() {
    if(this.bridge.isDawBusy?.()||this.bridge.isStudioBusy?.()){
      this.say(MESSAGES.busy);
      return;
    }
    if(this.bridge.getAudio().context?.state!=='running')return;
    this.token=crypto.randomUUID();
    this.mode='demonstrate';
    this.point(0);
    this.say('Preparando exemplo…');
    this.bridge.send({t:'music-lab-start',token:this.token,ppq:this.lesson.ppq,bpm:this.bpm,
      notes:this.lesson.notes.map(({pitch:{midi},startTick,durationTick})=>({midi,startTick,durationTick}))});
    this.refresh();
  }

  stop(message='') {
    if(!this.token)return;
    this.bridge.send({t:'music-lab-stop',token:this.token});
    this.token=null;
    this.mode='observe';
    this.point(-1);
    this.say(message);
    this.refresh();
  }

  receive(message) {
    if(message.t==='ready'||message.t==='error'){
      if(message.t==='error')this.stop();
      this.refresh();
      return;
    }
    if(message.t!=='music-lab-state'||message.token!==this.token)return;
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
    const midi=connected?'MIDI conectado · avaliação prevista':'Sem MIDI · leitura e exemplo disponíveis';
    if(this.audioStatus.textContent!==audio)this.audioStatus.textContent=audio;
    if(this.midiStatus.textContent!==midi)this.midiStatus.textContent=midi;
    const hideStart=running||silent;
    if(this.audioAction.hidden!==hideStart)this.audioAction.hidden=hideStart;
    const audioAction=context?.state==='suspended'?'Retomar áudio':'Iniciar áudio';
    if(this.audioAction.textContent!==audioAction)this.audioAction.textContent=audioAction;
    const disabled=!running||!!this.token;
    if(this.listen.disabled!==disabled)this.listen.disabled=disabled;
    if(this.halt.hidden===!!this.token)this.halt.hidden=!this.token;
  }
}
