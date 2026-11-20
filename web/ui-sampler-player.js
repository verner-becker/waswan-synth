// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {inspectSample,readSampleFile,search,inspect} from './sampler-library.js';
import {prepareSampler,prepareSamplePreview} from './sampler.js';
import {runOffline} from './sampler-offline.js';

export class SamplerPlayerPanel {
  constructor(studio,openStudio,context){
    this.studio=studio;this.context=context;this.items=new Map();
    this.node=el('div','ww-sampler-player');
    this.trigger=action('Sampler player',()=>this.menu.togglePopover());
    this.trigger.setAttribute('aria-expanded','false');
    this.menu=el('div','ww-sampler-player-menu ww-panel');this.menu.popover='auto';
    this.menu.id='ww-sampler-player-'+context;this.trigger.setAttribute('aria-controls',this.menu.id);
    this.menu.setAttribute('role','dialog');this.menu.setAttribute('aria-label','Sampler player');
    const label=el('label','','Player sound');this.sound=el('select');this.sound.setAttribute('aria-label','Player sound');label.append(this.sound);
    const filters=el('form','ww-sampler-actions');this.query=el('input');this.query.type='search';this.query.setAttribute('aria-label','Filter player sounds');this.query.placeholder='Name or tag';
    this.kind=el('select');this.kind.setAttribute('aria-label','Player library category');
    this.kind.append(new Option('Instruments','instrument'),new Option('Kits','kit'),new Option('Samples','sample'));
    this.kind.onchange=()=>this.run(()=>this.refresh());const searchButton=el('button','','Search');searchButton.type='submit';
    filters.onsubmit=e=>{e.preventDefault();this.run(()=>this.refresh());};filters.append(this.query,this.kind,searchButton);
    this.more=action('More player sounds',()=>this.run(()=>this.refresh(this.cursor)));
    this.status=el('p','ww-muted');this.status.setAttribute('role','status');
    this.route=el('p','ww-sampler-route');const tools=el('div','ww-sampler-actions');
    this.preview=action('Preview reference sample',()=>this.run(()=>this.listen()));
    this.stop=action('Stop sample preview',()=>{studio.audition.stop();this.status.textContent='';});
    this.play=action('Play on Synth keyboard',()=>this.run(()=>this.playSound()));
    this.release=action('Release Synth keyboard',()=>this.run(async()=>{await studio.releaseLive();this.status.textContent='';}));
    this.assign=action('Assign Official to selected DAW track',()=>this.run(()=>this.assignSound()));
    this.assign.hidden=context!=='daw';
    this.open=action('Open Sampler Studio',()=>this.run(async()=>{
      const selected=this.items.get(this.sound.value);
      if(selected){await studio.openEntry(selected);if(studio.draft?.source.path!==selected.path&&studio.draft?.baseRef?.path!==selected.path)return;}
      this.menu.hidePopover();openStudio();
    }));
    this.close=action('Close player',()=>this.menu.hidePopover());
    tools.append(this.preview,this.stop,this.play,this.release,this.assign,this.open,this.close);
    this.sound.onchange=()=>this.sync();
    this.menu.append(el('strong','','Sampler player'),this.route,filters,label,this.more,tools,this.status);this.node.append(this.trigger,this.menu);
    this.menu.ontoggle=({newState})=>{
      this.trigger.setAttribute('aria-expanded',String(newState==='open'));
      if(newState==='open')this.run(async()=>{await studio.activate();await this.refresh();if(this.menu.ownerDocument.hasFocus()&&this.menu.matches(':popover-open'))this.sound.focus();});
    };
    this.sync();
  }
  async run(fn){
    if(this.busy)return;
    this.busy=true;
    try{await fn();}
    catch(error){this.status.textContent=error.message;}
    finally{this.busy=false;this.sync();}
  }
  async refresh(cursor){
    const s=this.studio,previous=this.sound.value;
    if(!cursor){
      this.items.clear();this.sound.replaceChildren();
      if(s.draft){
        this.sound.append(new Option('Working · '+s.draft.name,'working'));
        if(s.draft.baseRef)this.sound.append(new Option('Official r'+s.draft.baseRef.revision+' · '+s.draft.name,'official'));
      }
    }
    if(s.library){
      const page=await search(s.root,{kind:this.kind.value,text:this.query.value.trim(),limit:30,cursor});
      for(const item of page.items){
        this.items.set(item.path,item);this.sound.append(new Option((item.displayName||item.name)+(item.revision?' · r'+item.revision:''),item.path));
      }
      this.cursor=page.nextCursor;
    }else this.cursor=null;
    if([...this.sound.options].some(o=>o.value===previous))this.sound.value=previous;
    this.more.hidden=!this.cursor;this.status.textContent=s.library?'':'Choose your Samples folder in Sampler Studio.';
  }
  ref(entry){
    return entry?{type:'sampler',libraryId:this.studio.library.id,instrumentId:entry.id,revision:entry.revision,path:entry.path}:this.studio.draft.baseRef;
  }
  async listen(){
    const s=this.studio,key=this.sound.value,entry=this.items.get(key);
    let wav;
    if(!entry)wav=await s.history.versionWav(key);
    else if(entry.kind==='sample')wav=await readSampleFile(s.root,await inspectSample(s.root,entry.path));
    else{
      const {instrument}=await inspect(s.root,this.ref(entry)),region=instrument.regions[0];
      const sample=instrument.samples.find(x=>x.id===region.sample);
      wav=await readSampleFile(s.root,sample);
      if(region.frames[0]!==0||region.frames[1]!==sample.frames)
        wav=(await runOffline(wav,{type:'edit',recipe:[{type:'trim',start:region.frames[0],end:region.frames[1]}]})).wav;
    }
    await s.audition.play(wav);this.status.textContent='Previewing the reference sample.';
  }
  async playSound(){
    const s=this.studio,key=this.sound.value,entry=this.items.get(key);
    if(!entry){await s.assignLive(key==='official');}
    else{
      const prepare=async()=>{
        if(entry.kind!=='sample')return prepareSampler(s.player,s.root,this.ref(entry));
        const sample=await inspectSample(s.root,entry.path);
        let file=await readSampleFile(s.root,sample);
        if(sample.sampleRate!==44100)file=(await runOffline(file,{type:'edit',recipe:[{type:'rate',sampleRate:44100}]})).wav;
        return prepareSamplePreview(s.player,file,60);
      };
      await s.playPrepared(prepare,(entry.displayName||entry.name)+(entry.revision?' · Official r'+entry.revision:' · root 60'));
    }
    this.status.textContent='';
  }
  async assignSound(){
    const s=this.studio,entry=this.items.get(this.sound.value),ref=this.ref(entry);
    const name=await s.assignOfficial(()=>prepareSampler(s.player,s.root,ref));this.status.textContent='Assigned Official r'+ref.revision+' to '+name;
  }
  sync(){
    const s=this.studio,k=this.sound.value,entry=this.items.get(k);
    this.route.textContent=s.route.textContent;
    this.play.disabled=this.preview.disabled=!k||this.busy||s.busy;
    this.release.disabled=!s.liveName||s.busy||this.busy;
    this.assign.disabled=!(k==='official'||entry&&entry.kind!=='sample')||this.busy||s.busy;
  }
}
