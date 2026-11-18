// SPDX-License-Identifier: GPL-3.0-only
const labels={clip:'Clip editor',mixer:'Mixer',effects:'Effects',automation:'Automation'};
export class DawWindows {
  constructor(workspace,onChange){
    this.w=workspace;
    this.onChange=onChange;
    this.views=new Map();
    addEventListener('pagehide',()=>this.closeAll(),{once:true});
    this.layoutKey='waswan-daw-window-layout-v1';
    try{this.positions=JSON.parse(localStorage.getItem(this.layoutKey))||{};}catch{this.positions={};}
  }
  label(name){return labels[name];}
  has(name){return this.views.has(name);}
  focus(name){
    const view=this.views.get(name);
    if(!view||view.win.closed)return false;
    view.win.focus();
    return true;
  }
  open(name,pane){
    if(this.focus(name))return;
    if(this.has(name))this.attach(name);
    if(!Object.hasOwn(labels,name)||!pane)return;
    const stored={width:850,height:460,...this.positions[name]};
    const position=['left','top','width','height'].flatMap(key=>Number.isInteger(stored[key])?[key+'='+stored[key]]:[]);
    const win=pane.ownerDocument.defaultView.open('','_blank',['popup',...position].join(','));
    if(!win){this.w.error(Error('Allow pop-ups for WASWAN to detach this panel'));return;}
    const doc=win.document,anchor=pane.ownerDocument.createComment('WASWAN '+name+' panel');
    const restoreFocus=pane.ownerDocument.activeElement;
    pane.before(anchor);
    try{
      doc.documentElement.lang='en';
      doc.title='WASWAN DAW · '+labels[name];
      doc.body.classList.add('ww-page');
      const css=doc.createElement('link');
      css.rel='stylesheet';
      css.href=new URL('./ui-foundation.css',import.meta.url).href;
      doc.head.append(css);
      const shell=doc.createElement('main');
      shell.className='ww-shell ww-daw-detached';
      const header=doc.createElement('header'),title=doc.createElement('h1'),close=doc.createElement('button'),status=doc.createElement('output');
      title.textContent=labels[name];
      close.type='button';
      close.textContent='Return panel to DAW';
      close.onclick=()=>this.attach(name);
      status.setAttribute('aria-label','DAW transport status');
      header.append(title,status,close);
      shell.append(header,pane);
      doc.body.replaceChildren(shell);
      const focus=()=>this.w.panelFocus(name,{detached:true});
      const view={win,pane,anchor,status,focus,restoreFocus};
      this.views.set(name,view);
      doc.addEventListener('keydown',event=>this.w.shortcut(event));
      doc.addEventListener('pointerdown',focus);
      win.addEventListener('focus',focus);
      if(name==='clip')win.addEventListener('blur',()=>void this.w.audition?.release());
      win.addEventListener('pagehide',()=>this.attach(name,{closing:true}),{once:true});
      win.addEventListener('resize',()=>this.remember(name,win));
      this.watch??=setInterval(()=>{for(const [key,view] of this.views)if(view.win.closed)this.attach(key,{closing:true});},400);
      pane.hidden=false;
      this.onChange();
      focus();
      win.focus();
      this.status();
    }catch(error){
      if(this.views.has(name))this.attach(name,{closing:true,refresh:false});
      else anchor.replaceWith(pane);
      win.close();
      this.w.error(error);
    }
  }
  remember(name,win){
    if(win.closed)return;
    try{
      this.positions[name]={left:win.screenX,top:win.screenY,width:win.outerWidth,height:win.outerHeight};
      localStorage.setItem(this.layoutKey,JSON.stringify(this.positions));
    }catch{}
  }
  attach(name,{closing=false,refresh=true}={}){
    const view=this.views.get(name);
    if(!view)return;
    this.views.delete(name);
    if(name==='clip')void this.w.audition?.release();
    if(!this.views.size){clearInterval(this.watch);this.watch=null;}
    this.remember(name,view.win);
    view.anchor.replaceWith(view.pane);
    if(!closing&&!view.win.closed)view.win.close();
    if(refresh){
      this.onChange();
      const target=view.restoreFocus?.getClientRects().length?view.restoreFocus:this.w.layout.focusTarget();
      if(!this.w.node.hidden)target.focus({preventScroll:true});
    }
  }
  closeAll({forget=false}={}){
    for(const name of this.views.keys())this.attach(name,{refresh:false});
    if(forget){this.positions={};try{localStorage.removeItem(this.layoutKey);}catch{}}
  }
  status(){
    const w=this.w;
    const record=w.recorder?.state;
    const state=record==='count-in'&&!w.recorder.settings.countIn?'Starting':{
      preparing:'Preparing', 'count-in':'Count-in', recording:'Recording', finalizing:'Finishing'
    }[record]||(w.player.playing?'Playing':'Stopped');
    for(const {status} of this.views.values()){
      status.textContent=w.snapshot.name+' · '+state+' · '+w.position.textContent;
      status.dataset.state=record||'idle';
    }
  }
}
