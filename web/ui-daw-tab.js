// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';

export class DawTab {
  constructor(workspace,{onMove,focusSynth,onError}){
    Object.assign(this,{workspace,onMove,focusSynth,onError});
    addEventListener('message',event=>this.attach(event));
    addEventListener('pagehide',()=>this.restore(),{once:true});
  }
  get connected(){return !!this.home;}
  report(message){this.workspace.error(Error(message));this.onError(message);}
  open(){
    if(this.win&&!this.win.closed){this.win.focus();return;}
    this.restore();
    const token=crypto.randomUUID(),url=new URL('./daw-tab.html',import.meta.url);
    url.hash=token;
    const win=window.open(url,'_blank');
    if(!win){this.report('Allow new tabs for WASWAN, then try opening the DAW again');return;}
    this.token=token;
    this.win=win;
    this.watch=setInterval(()=>{if(win.closed)this.restore();},500);
    this.deadline=setTimeout(()=>{
      if(this.win===win&&!this.connected){this.restore();this.report('The DAW tab could not connect to this session');}
    },6000);
  }
  attach(event){
    if(this.connected||!this.win||event.source!==this.win||event.origin!==location.origin||
      event.data?.type!=='waswan-daw-tab-ready'||event.data.token!==this.token)return;
    const win=this.win;
    let doc,target;
    try{doc=win.document;target=doc.querySelector('[data-daw-tab-content]');}catch{return;}
    if(!target)return;
    clearTimeout(this.deadline);
    const w=this.workspace,node=w.node,placeholder=el('section','ww-panel');
    placeholder.dataset.view='daw';
    placeholder.hidden=node.hidden;
    placeholder.append(el('p','','DAW is open in its own tab.'),action('Focus DAW tab',()=>win.focus()),
      action('Return DAW here',()=>this.restore()));
    this.home={placeholder,dialogs:[w.recoveryDialog,w.takeDialog,w.audioExport.dialog]};
    node.replaceWith(placeholder);
    this.onMove(placeholder);
    target.replaceChildren(node);
    node.hidden=false;
    doc.body.append(...this.home.dialogs);
    doc.querySelector('header').append(
      action('Focus Synth',()=>{this.focusSynth();window.focus();}),
      action('Return DAW to Synth tab',()=>this.restore())
    );
    win.addEventListener('pagehide',()=>{if(this.win===win)this.restore({close:false});},{once:true});
    win.addEventListener('resize',()=>w.layout.measure());
    const focus=()=>w.midiProfiles.focus(w.hostMidiContext||'transport');
    win.addEventListener('focus',focus);
    win.addEventListener('blur',()=>void w.audition.release());
    focus();
    w.layout.windowChanged();
  }
  restore({close=true}={}){
    const win=this.win,home=this.home,w=this.workspace;
    this.win=this.home=this.token=null;
    clearInterval(this.watch);
    clearTimeout(this.deadline);
    if(home){
      const {placeholder,dialogs}=home;
      for(const dialog of dialogs){if(dialog.open)dialog.close();document.body.append(dialog);}
      w.node.hidden=placeholder.hidden;
      placeholder.replaceWith(w.node);
      this.onMove(w.node);
      w.layout.windowChanged();
    }
    if(close&&win&&!win.closed)win.close();
  }
}
