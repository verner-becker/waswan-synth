// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';

// Presentation only: the engine supplies the catalog, current program and edit guard.
export class ToneSelector {
  constructor(send) {
    this.send=send;this.request=0;this.failure=false;
    this.node=el('select','ww-tone-selector');this.node.setAttribute('aria-label','Tone program');
    this.node.add(new Option('Instrument not started',''));this.node.disabled=true;
    this.detail=el('small','ww-muted','Original sound engine · 256-voice pool');this.detail.id='ww-tone-detail';this.node.setAttribute('aria-describedby',this.detail.id);
    this.dialog=el('dialog','ww-map-dialog ww-tone-confirm');this.dialog.setAttribute('aria-labelledby','ww-tone-confirm-title');
    const title=el('h2','','Discard unsaved tone edits?');title.id='ww-tone-confirm-title';this.question=el('p');
    const cancel=action('Cancel',()=>{this.intent=null;this.dialog.close();});cancel.autofocus=true;
    this.dialog.append(title,this.question,cancel,action('Discard and load',()=>{if(this.intent)this.commit(this.intent,true);this.intent=null;this.dialog.close();}));document.body.append(this.dialog);
    this.dialog.addEventListener('cancel',()=>{this.intent=null;});
    // A delayed close event from a cancelled dialog must not clear a newly opened intent.
    this.dialog.addEventListener('close',()=>{if(!this.dialog.open)this.node.focus();});
    this.node.addEventListener('change',()=>this.choose(Number(this.node.value)));
  }
  choose(program) {
    const f=this.frame;if(!f?.instrument?.programAvailable)return;
    const current=f.programs[f.track];this.node.value=String(current);
    if(program===current||!this.library?.some(p=>p.number===program))return;
    this.failure=false;
    const intent={program,scope:f.instrument.scope,token:f.instrument.programToken};
    if(f.instrument.edited){
      this.intent=intent;const next=this.library.find(p=>p.number===program);
      this.question.textContent=`Part ${'ABCD'[f.track]} · Program ${current} (${f.instrument.name}) has unsaved edits. Loading Program ${program} (${next.name}) replaces them. Save in TONES or Legacy SMK first if you want to keep them.`;
      this.dialog.showModal();
    }else this.commit(intent,false);
  }
  commit(intent,discard) {
    this.pending=++this.request;this.send({t:'program-select',...intent,discard,request:this.pending});
  }
  update(frame,running) {
    this.frame=frame;const f=frame.instrument,current=frame.programs[frame.track];
    if(frame.programLibrary){
      this.library=frame.programLibrary;this.currentKey=null;this.previousOption=null;this.node.replaceChildren();
      for(const p of this.library)this.node.add(new Option(`${p.number} · ${p.name}`,String(p.number)));
    }
    // Restore the previous stored label, then display the current live name, including edits.
    const key=`${current}:${f?.name}`;
    if(this.currentKey!==key){
      this.currentKey=key;if(this.previousOption)this.previousOption.label=this.previousLabel;
      const item=this.library?.find(p=>p.number===current),option=this.node.options[current-1];
      if(item&&option){this.previousOption=option;this.previousLabel=`${current} · ${item.name}`;option.label=`${current} · ${f?.name||item.name}`;}
    }
    if(this.node.value!==String(current))this.node.value=String(current);this.node.disabled=!running||!f?.programAvailable||!this.library;
    this.node.title=`Program ${current} · ${f?.name??''}`;
    if(this.pending&&frame.programSelection?.request===this.pending){this.failure=!frame.programSelection.applied;this.pending=null;}
    this.detail.textContent=`Program ${current}${f?.edited?' · Edited · save in TONES':''}${this.failure?' · Selection not applied; retry':''}`;
  }
}
