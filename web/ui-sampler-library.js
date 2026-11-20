// SPDX-License-Identifier: GPL-3.0-only
import {el} from './ui-primitives.js';
import {listChildren,search} from './sampler-library.js';
import {listWorking} from './sampler-working.js';

export class SamplerLibraryBrowser {
  constructor(studio) {
    this.studio=studio;
    this.node=el('div','ww-sampler-browser');
    this.folder=el('strong','','No Samples folder');
    this.choose=studio.button('Choose Samples folder…',()=>studio.chooseFolder());
    this.allow=studio.button('Allow folder access',()=>studio.allowFolder());
    const actions=el('div','ww-sampler-actions');
    actions.append(this.choose,this.allow);
    this.tools=el('div','ww-sampler-library-content');
    this.query=el('input');this.query.type='search';this.query.placeholder='Name or tag';this.query.setAttribute('aria-label','Search sampler library');
    const searchForm=el('form','ww-sampler-actions'),submit=el('button','','Search');submit.type='submit';
    this.query.oninput=()=>{if(!this.query.value&&this.term)void studio.run(()=>this.browse(''));};
    searchForm.onsubmit=event=>{event.preventDefault();void studio.run(()=>this.browse('',this.query.value.trim()));};
    searchForm.append(this.query,submit);
    this.breadcrumb=el('span','ww-muted');this.up=studio.button('Up one folder',()=>this.browse(this.path.split('/').slice(0,-1).join('/')));
    const location=el('div','ww-sampler-actions');location.append(this.up,this.breadcrumb);
    this.list=el('ul');this.list.setAttribute('aria-label','Library entries');
    this.more=studio.button('More results',()=>this.page(this.cursor));
    this.working=el('ul');this.working.setAttribute('aria-label','Saved Working Copies');
    this.tools.append(searchForm,location,this.list,this.more,el('h3','','Working copies'),this.working);
    this.node.append(this.folder,actions,this.tools);this.reset();
  }
  reset() {
    this.path='';this.term='';this.query.value='';this.list.replaceChildren();this.working.replaceChildren();
    this.tools.hidden=true;this.allow.hidden=true;this.choose.disabled=!globalThis.showDirectoryPicker;
  }
  async refresh() {
    this.folder.textContent=this.studio.root?.name||'No Samples folder';
    this.tools.hidden=!this.studio.library;
    this.allow.hidden=!this.studio.root||!!this.studio.library;
    if(!this.studio.library)return;
    await this.page();
    await this.refreshWorking();
  }
  async refreshWorking() {
    const drafts=await listWorking(this.studio.root);
    this.working.replaceChildren();
    for(const draft of drafts){
      const row=el('li');row.append(this.studio.button(draft.name,()=>this.studio.reopen(draft.id)),el('small','ww-muted',draft.diagnostic?.message||'Saved '+draft.generation));this.working.append(row);
    }
    if(!drafts.length)this.working.append(el('li','ww-muted','No saved Working Copies'));
  }
  async browse(path,term='') {
    this.path=path;this.term=term;this.query.value=term;await this.page();
  }
  async page(cursor) {
    const root=this.studio.root,options={limit:30,cursor};
    const result=this.term?await search(root,{...options,text:this.term}):await listChildren(root,this.path,options);
    if(!cursor)this.list.replaceChildren();
    this.up.hidden=!this.term&&!this.path;
    this.breadcrumb.textContent=this.term?'Results for “'+this.term+'”':'Library'+(this.path?' / '+this.path:'');
    for(const entry of result.items){
      if(entry.path==='Drafts'||entry.path.startsWith('Drafts/'))continue;
      const row=el('li'),label=entry.displayName||entry.name;
      if(entry.kind==='directory')row.append(this.studio.button(label,()=>this.browse(entry.path)));
      else if(['sample','instrument','kit'].includes(entry.kind))row.append(this.studio.button(label,()=>this.studio.openEntry(entry)));
      else if(entry.kind==='preset')row.append(this.studio.button(label,()=>this.studio.interchange.select(entry)));
      else row.append(el('span','ww-muted',label));
      if(['instrument','kit'].includes(entry.kind)){
        const add=this.studio.button('Add to Fusion',async()=>{
          await this.studio.fusion.addRef({type:'sampler',libraryId:this.studio.library.id,instrumentId:entry.id,revision:entry.revision,path:entry.path});
          this.studio.sections.get('Sound Fusion').open=true;
        });
        add.setAttribute('aria-label','Add '+label+' to Fusion');row.append(add);
      }
      if(entry.kind==='sample'){
        const add=this.studio.button('Add to builder',()=>this.studio.builder.fromLibrary(entry.path));
        add.setAttribute('aria-label','Add '+label+' to builder');row.append(add);
      }
      row.append(el('small','ww-muted',entry.diagnostic?.message||(entry.kind==='directory'?'Folder':entry.kind+(entry.revision?' · r'+entry.revision:''))));
      this.list.append(row);
    }
    if(!this.list.children.length)this.list.append(el('li','ww-muted','No matching entries'));
    this.cursor=result.nextCursor;this.more.hidden=!this.cursor;
  }
}
