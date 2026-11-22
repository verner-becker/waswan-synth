// SPDX-License-Identifier: GPL-3.0-only
import {action,el} from './ui-primitives.js';
import {subscribeDawInput} from './daw-input-events.js';
import {LabAssessment,labMidiEvent} from './music-lab-assessment.js';
import {LabProgress} from './music-lab-progress.js';
import {pitchLabel} from './music-lab-model.js';

const MAX_PENDING=256;
const NAMES=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const seconds=new Intl.NumberFormat('pt-BR',{style:'unit',unit:'second',maximumFractionDigits:2});
const dates=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'});
const duration=ms=>seconds.format(ms/1000);

function scoreText({matched,expected,extras,missing,retries},chord) {
  const parts=[`${matched}/${expected} ${chord?'acorde':'notas na ordem'}`];
  if(extras)parts.push(extras===1?'1 nota fora do alvo':`${extras} notas fora do alvo`);
  if(missing)parts.push(chord?'Acorde incompleto':missing===1?'1 nota faltou':`${missing} notas faltaram`);
  if(retries)parts.push(retries===1?'1 acorde fora da janela':`${retries} acordes fora da janela`);
  return parts.join(' · ');
}

export class MusicLabMidiPractice {
  constructor({bridge,conflict,onState,onObserved}) {
    Object.assign(this,{bridge,conflict,onState,onObserved,state:'idle'});
    let storage;
    try{storage=window.localStorage;}catch{}
    this.progress=new LabProgress(storage);
    this.start=action('Iniciar prática MIDI',()=>this.begin(),'ww-primary');
    this.end=action('Encerrar tentativa',()=>this.endAttempt());
    this.channel=el('select');
    this.channel.add(new Option('Automático',''));
    for(let i=0;i<16;i++)this.channel.add(new Option(String(i+1),String(i)));
    const label=el('label','ww-lab-field','Canal MIDI');
    label.append(this.channel);
    this.controls=el('div','ww-lab-midi-controls');
    this.controls.append(this.start,this.end,label);
    this.availability=el('p','ww-lab-midi-availability');
    this.feedback=el('p','ww-lab-midi-feedback');
    this.feedback.setAttribute('role','status');
    this.details=el('p','ww-lab-midi-details');
    this.history=el('details','ww-lab-history');
    this.historyTitle=el('summary');
    this.historyList=el('ol');
    this.history.append(this.historyTitle,this.historyList);
  }

  get hasAttempt() {
    return !!this.attempt;
  }

  setLesson(lesson,groups,getTempo) {
    this.detach();
    Object.assign(this,{lesson,groups,getTempo,state:'idle',attempt:null,lastHold:null,lastMessage:''});
    this.chord=groups.some(group=>group.notes.length>1);
    this.paint();
    this.renderHistory();
  }

  lossReason() {
    const {input,generation}=this.bridge.midi;
    if(this.lease&&(input!==this.lease.input||generation!==this.lease.generation||input?.state==='disconnected'))
      return 'A entrada MIDI mudou. Reconecte ou escolha um dispositivo para retomar.';
    if(!this.bridge.isRunning()||this.bridge.getAudio().context?.state!=='running')
      return 'O áudio pausou. Retome o Synth para continuar.';
    return this.conflict();
  }

  refresh(demo=this.demo) {
    this.demo=demo;
    if(this.lease){
      const reason=this.lossReason();
      if(reason)this.pause(reason);
    }
    const input=this.bridge.midi.input;
    const reason=this.lossReason();
    const disabled=!!demo||!input||input.state==='disconnected'||!!reason||this.lesson?.mode!=='strict';
    if(this.start.disabled!==disabled)this.start.disabled=disabled;
    const availability=input&&this.bridge.getAudio().context?.state==='running'&&this.state!=='paused'?reason:'';
    if(this.availability.textContent!==availability)this.availability.textContent=availability;
  }

  begin() {
    this.refresh();
    if(this.lease||this.start.disabled)return;
    const channel=this.channel.value===''?null:Number(this.channel.value);
    const resume=this.state==='paused';
    if(resume)this.attempt.resume(channel);
    else this.attempt=new LabAssessment(this.groups,{channel,bpm:this.getTempo(),ppq:this.lesson.ppq,
      chordWindowMs:this.lesson.evaluation?.chordOnsetWindowMs??120});
    this.state='listening';
    this.lastHold=null;
    this.lastMessage=resume?'Prática retomada. Toque o alvo destacado.':
      this.chord?`Toque as notas do acorde juntas. Janela de ${this.attempt.chordWindowMs} ms.`:
        'Toque a nota destacada. A pauta avança a cada acerto.';
    const {input,generation}=this.bridge.midi;
    const lease={input,generation,pending:[],frame:0};
    this.lease=lease;
    lease.unsubscribe=subscribeDawInput(event=>{
      if(event.deviceId!==input.id||!event.running||!event.listening||event.consumed)return;
      if(lease.pending.length>MAX_PENDING)return;
      lease.pending.push(event);
      if(!lease.frame)lease.frame=requestAnimationFrame(()=>this.consume(lease));
    });
    this.onObserved(null);
    this.onState('listening',this.attempt.index);
    this.paint();
    if(this.attempt.complete)this.finish();
    else this.end.focus({preventScroll:true});
  }

  consume(lease) {
    if(this.lease!==lease)return;
    lease.frame=0;
    const reason=this.lossReason();
    if(reason){this.pause(reason);return;}
    if(lease.pending.length>MAX_PENDING){this.pause('A entrada enviou muitas mensagens. Retome para continuar.');return;}
    const batch=lease.pending.splice(0);
    let observed,matched=false;
    for(const raw of batch){
      const event=labMidiEvent(raw);
      if(!event)continue;
      if(this.attempt.channel!==null&&event.channel!==this.attempt.channel)continue;
      if(raw.routed){
        this.pause('A entrada MIDI foi encaminhada a outro destino.');
        return;
      }
      const result=this.attempt.input(event);
      if(!result)continue;
      if(result.kind==='reset'){this.pause('A entrada liberou as notas. Retome quando estiver pronto.');return;}
      if(result.kind==='release'&&result.ms!==undefined)this.lastHold=result;
      if(result.kind==='match')matched=true;
      if(result.pitch!==undefined&&result.kind!=='release'){
        observed={pitch:result.pitch,correct:result.kind==='match'||result.kind==='partial'};
        this.lastMessage=this.describe(result);
      }
      if(this.attempt.complete)break;
    }
    if(this.attempt.complete){this.finish();return;}
    if(observed)this.onObserved(observed);
    if(matched)this.onState('listening',this.attempt.index);
    this.paint();
  }

  name(pitch) {
    const note=this.lesson.notes.find(note=>note.pitch.midi===pitch);
    return note?pitchLabel(note.pitch):NAMES[pitch%12]+(Math.floor(pitch/12)-1);
  }

  describe({kind,pitch,chord}) {
    switch(kind){
    case 'match': {
      const hit=chord?'✓ Acorde correto.':`✓ ${this.name(pitch)} correta.`;
      return this.attempt.index===this.groups.length?hit+' Solte as teclas para concluir.':hit;
    }
    case 'extra': return `! Tocou ${this.name(pitch)} fora do alvo. ${this.chord?'Solte as teclas e tente o acorde novamente.':'Tente a nota destacada.'}`;
    case 'wide': return `! Os ataques passaram de ${this.attempt.chordWindowMs} ms. Solte as teclas e toque juntas de novo.`;
    case 'partial': return `${this.name(pitch)} recebida. Complete o acorde com as teclas juntas.`;
    default: return 'Solte as teclas antes de tentar o acorde novamente.';
    }
  }

  detach() {
    const lease=this.lease;
    if(!lease)return;
    this.lease=null;
    lease.unsubscribe();
    if(lease.frame)cancelAnimationFrame(lease.frame);
  }

  hostRelease() {
    const lease=this.lease;
    if(lease)queueMicrotask(()=>{
      if(this.lease===lease)this.pause(this.lossReason()||'O instrumento liberou as notas. Retome quando estiver pronto.');
    });
  }

  pause(reason) {
    if(!this.lease)return;
    this.detach();
    this.attempt.resume(this.attempt.channel);
    this.state='paused';
    this.lastMessage=reason;
    this.onObserved(null);
    this.onState('paused',this.attempt.index);
    this.paint();
  }

  discard() {
    this.setLesson(this.lesson,this.groups,this.getTempo);
    this.onObserved(null);
    this.onState('observe',0);
    this.start.focus({preventScroll:true});
  }

  endAttempt() {
    if(this.state==='paused'){this.discard();return;}
    if(this.lease?.frame){
      cancelAnimationFrame(this.lease.frame);
      this.consume(this.lease);
    }
    this.finish();
  }

  finish() {
    if(!this.lease)return;
    this.detach();
    if(!this.attempt.attacks){
      this.discard();
      this.lastMessage='Nenhuma nota MIDI recebida nesta tentativa.';
      this.paint();
      return;
    }
    const summary=this.attempt.summary(),stored=this.progress.record(this.lesson,summary);
    this.attempt=null;
    this.state='review';
    const chordClock=summary.windowUnavailable?' Janela do acorde indisponível nesta tentativa.':'';
    const next=summary.missing?' Tente novamente acompanhando o alvo destacado.':'';
    const save=stored?'':' O armazenamento local está indisponível. O resumo fica visível nesta aba.';
    this.lastMessage=scoreText(summary,this.chord)+'.'+chordClock+next+save;
    this.onObserved(null);
    this.onState('review',-1);
    const returnFocus=document.activeElement===this.end;
    this.paint();
    this.renderHistory();
    if(returnFocus)this.start.focus({preventScroll:true});
  }

  paint() {
    this.controls.dataset.state=this.state;
    this.start.hidden=this.state==='listening';
    this.start.textContent=this.state==='paused'?'Retomar prática MIDI':
      this.state==='review'?'Tentar novamente':'Iniciar prática MIDI';
    this.end.hidden=!this.hasAttempt;
    this.end.textContent=this.state==='paused'?'Descartar tentativa':'Encerrar tentativa';
    this.channel.disabled=this.state==='listening';
    if(this.feedback.textContent!==this.lastMessage)this.feedback.textContent=this.lastMessage;
    const parts=[];
    if(this.attempt){
      if(this.attempt.channel!==null)parts.push(`Canal ${this.attempt.channel+1}`);
      if(this.state==='paused')parts.push(`${this.attempt.index}/${this.groups.length} alvos mantidos`);
      const pedal=this.attempt.pedals.get(this.attempt.channel);
      if(pedal!==undefined)parts.push(pedal?'Pedal pressionado':'Pedal solto');
    }
    if(this.lastHold)parts.push(`${this.name(this.lastHold.pitch)} pressionada por ${duration(this.lastHold.ms)} · referência ${duration(this.lastHold.reference)}`);
    if(this.hasAttempt||this.state==='review')parts.push('Duração de tecla é informativa. Ritmo sem pontuação.');
    const detail=parts.join(' / ');
    if(this.details.textContent!==detail)this.details.textContent=detail;
  }

  renderHistory() {
    const record=this.progress.get(this.lesson);
    this.history.hidden=!record;
    if(!record)return;
    const count=record.attempts;
    this.historyTitle.textContent=`Progresso local · ${count} ${count===1?'tentativa':'tentativas'}`;
    this.historyList.replaceChildren(...record.history.map(({at,summary})=>{
      const hold=summary.holdSamples?` · média de tecla ${duration(summary.holdMeanMs)}`:'';
      return el('li','',`${dates.format(at)} · ${scoreText(summary,this.chord)}${hold}`);
    }));
  }
}
