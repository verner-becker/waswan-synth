// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';

export class SamplerWindow {
  constructor(studio,onMove){
    this.studio=studio;this.onMove=onMove;
    addEventListener('pagehide',()=>this.dock());
  }
  open(){
    if(this.win&&!this.win.closed){this.win.focus();return;}
    const win=window.open('','_blank','popup,width=1160,height=820,resizable=yes,scrollbars=yes');
    if(!win){this.studio.status.textContent='Allow pop-up windows, then open Sampler Studio again.';return;}
    this.win=win;
    const doc=win.document,s=this.studio,node=s.node;
    doc.documentElement.lang='en';doc.title='WASWAN · Sampler Studio';
    const css=doc.createElement('link');css.rel='stylesheet';css.href=new URL('./ui-foundation.css',import.meta.url).href;doc.head.append(css);
    doc.body.className='ww-page';const shell=el('main','ww-shell ww-sampler-linked');
    const heading=el('header','ww-sampler-actions');heading.append(el('strong','','WASWAN'),el('span','ww-muted','Audio host · Synth window'),action('Dock Sampler Studio',()=>this.dock()));
    const placeholder=el('section','ww-panel');placeholder.dataset.view='sampler';placeholder.hidden=node.hidden;
    placeholder.append(el('strong','','Sampler Studio is open in its own window.'),
      action('Focus Sampler window',()=>win.focus()),action('Dock Sampler Studio',()=>this.dock()));
    node.replaceWith(placeholder);this.placeholder=placeholder;this.onMove(placeholder);
    shell.append(heading,node);doc.body.append(shell);node.hidden=false;
    s.setLayout('window');s.detachButton.hidden=true;s.history.windowChanged?.();
    win.addEventListener('pagehide',()=>{if(this.win===win)this.dock(false);},{once:true});
    this.watch=setInterval(()=>{if(win.closed)this.dock(false);},500);
    win.focus();
  }
  dock(close=true){
    const win=this.win,placeholder=this.placeholder;
    if(!win||!placeholder)return;
    this.win=this.placeholder=null;clearInterval(this.watch);
    const s=this.studio,node=s.node;
    node.hidden=placeholder.hidden;placeholder.replaceWith(node);this.onMove(node);
    s.setLayout('main');s.detachButton.hidden=false;s.history.windowChanged?.();
    if(close&&!win.closed)win.close();
  }
}
