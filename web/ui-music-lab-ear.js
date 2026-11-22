// SPDX-License-Identifier: GPL-3.0-only
import {action,el} from './ui-primitives.js';

export class MusicLabEar {
  constructor({reload,update}) {
    Object.assign(this,{reload,update,index:0,revealed:false,listened:false});
    this.node=el('div','ww-lab-ear');
    this.options=el('div','ww-lab-ear-options');
    this.options.setAttribute('role','group');
    this.options.setAttribute('aria-label','Respostas do exercício de ouvido');
    this.reveal=action('Ver partitura',()=>{
      this.revealed=true;
      this.paint();
      this.update(true);
    });
    this.again=action('Outro desafio',()=>{
      if(this.quiz)this.index=(this.index+1)%this.config.trials.length;
      this.reset();
      this.reload();
    });
    this.status=el('span','ww-lab-ear-status');
    this.status.setAttribute('role','status');
    this.node.append(this.options,this.reveal,this.again,this.status);
    this.paint();
  }

  get quiz() {return !!this.config?.choices;}
  get concealed() {return !!this.config&&!this.revealed;}
  get trial() {return this.config?.trials?.[this.index];}

  set(config) {
    this.config=config;
    this.index=0;
    this.buttons=(config?.choices??[]).map((choice,i)=>action(choice,()=>this.answer(i)));
    this.options.replaceChildren(...this.buttons);
    this.again.textContent=this.quiz?'Outro desafio':'Recomeçar o eco';
    this.reset();
  }

  reset() {
    this.revealed=false;
    this.listened=false;
    this.choice=null;
    this.paint();
  }

  heard() {
    this.listened=true;
    this.paint();
    this.update();
  }

  answer(index) {
    if(!this.listened||this.choice!==null)return;
    this.choice=index;
    this.paint();
  }

  paint() {
    this.node.hidden=!this.config;
    this.options.hidden=!this.quiz;
    this.reveal.hidden=this.revealed;
    for(const [i,button] of (this.buttons??[]).entries()){
      button.disabled=!this.listened||this.choice!==null;
      button.setAttribute('aria-pressed',String(this.choice===i));
    }
    let message='';
    if(this.choice!==null&&this.choice!==undefined){
      const target=this.config.choices[this.index];
      message=this.choice===this.index?'✓ '+target+'.':'Resposta de referência · '+target+'.';
    }else if(this.config){
      message=this.quiz?(this.listened?'Escolha a resposta.':'Ouça a referência para responder.'):
        (this.listened?'Repita a frase de ouvido no teclado MIDI.':'Ouça o eco antes de tocar.');
    }
    if(this.status.textContent!==message)this.status.textContent=message;
  }
}
