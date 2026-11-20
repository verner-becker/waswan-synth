// SPDX-License-Identifier: GPL-3.0-only
import {action,el} from './ui-primitives.js';
import {createMiniWaveform} from './ui-sampler-waveform.js';
import {readSampleFile} from './sampler-library.js';
import {inspectWav} from './sampler-wav.js';
import {rangeWav} from './sampler-waveform.js';
import {prepareSamplePreview,prepareSampler} from './sampler.js';
import {createWorking,updateWorking,workingFromRef,createCheckpoint,checkpointWorking,restoreCheckpoint,branchWorking,
  undoWorking,redoWorking,discardWorking,startFromOriginal,repromoteWorking,previewWorkingWav,prepareWorking} from './sampler-working.js';

function select(label,parent){
  const wrap=el('label','',label),input=el('select');
  input.setAttribute('aria-label',label);wrap.append(input);parent.append(wrap);return input;
}
function input(label,parent,type='text'){
  const wrap=el('label','',label),control=el('input');control.type=type;
  control.setAttribute('aria-label',label);wrap.append(control);parent.append(wrap);return control;
}
const checkpointKey=id=>'checkpoint:'+id;

export class SamplerHistory {
  constructor(studio){
    this.studio=studio;this.cards=new Map();this.node=el('div','ww-sampler-history');
    this.makeObserver=()=>new this.node.ownerDocument.defaultView.IntersectionObserver(entries=>{
      for(const {target,isIntersecting} of entries){
        if(!isIntersecting)continue;
        const card=this.cards.get(target.dataset.version);
        if(card&&!card.loaded)this.draw(card);
      }
    });
    this.observer=this.makeObserver();this.versions=el('div','ww-sampler-version-cards');this.versions.setAttribute('aria-label','Versions');
    this.latest=el('div','ww-sampler-version-cards');this.latest.setAttribute('aria-label','Recent checkpoints');
    const toolbar=el('div','ww-sampler-actions'),button=(label,fn)=>studio.button(label,fn);
    this.undo=button('Undo working edit',()=>this.step(undoWorking));
    this.redo=button('Redo working edit',()=>this.step(redoWorking));
    this.copy=button('New Working Copy',()=>this.newCopy());
    const captured=el('div','ww-sampler-fields');
    this.name=input('Checkpoint name',captured);this.name.maxLength=128;
    this.check=button('Create Checkpoint',()=>this.capture());captured.append(this.check);
    toolbar.append(this.undo,this.redo,this.copy);
    const compare=el('div','ww-sampler-fields');this.compareA=select('Compare A',compare);
    this.compareB=select('Compare B',compare);this.listenA=button('Listen A',()=>this.listen(this.compareA,'A'));
    this.listenB=button('Listen B',()=>this.listen(this.compareB,'B'));
    this.playA=button('Play A on Synth keyboard',()=>this.play(this.compareA,'A'));
    this.playB=button('Play B on Synth keyboard',()=>this.play(this.compareB,'B'));
    this.stop=action('Stop comparison',()=>{studio.audition.stop();studio.status.textContent='Comparison stopped.';});
    compare.append(this.listenA,this.listenB,this.stop,this.playA,this.playB);
    const history=el('details','ww-sampler-full-history');history.append(el('summary','','Full history'));
    this.list=el('ol');
    const restore=el('div','ww-sampler-fields');
    this.selected=select('Checkpoint to restore',restore);
    this.branchName=input('Branch name',restore);this.branchName.placeholder='Optional';this.branchName.maxLength=128;
    this.restore=button('Restore Checkpoint',()=>this.fork(false));this.branch=button('Branch from Here',()=>this.fork(true));
    restore.append(this.restore,this.branch);
    const official=el('div','ww-sampler-fields');this.revision=input('Previous Official revision',official,'number');
    this.revision.min=1;this.revision.step=1;
    this.repromote=button('Re-promote Previous',()=>this.republish());official.append(this.repromote);
    this.discard=button('Discard Working',()=>this.discardDraft());
    this.start=button('Start Again from Original',()=>this.startOriginal());
    const reset=el('div','ww-sampler-actions');reset.append(this.discard,this.start);
    history.append(this.list,restore,official,reset);
    this.node.append(toolbar,compare,captured,history);
  }
  async step(operation){
    const s=this.studio,next=operation(s.draft);
    await s.adopt(next,s.file,{dirty:true});
    s.status.textContent='Working updated · '+next.name;
  }
  async capture(){
    const s=this.studio;
    const name=this.name.value.trim()||'Checkpoint '+((s.draft.history?.checkpoints?.length||0)+1);
    s.draft=await createCheckpoint(s.root,s.draft,name);s.dirty=false;
    this.name.value='';s.status.textContent='Checkpoint saved · '+name;await s.browser.refreshWorking();
  }
  async switchTo(draft,{dirty=true}={}){
    const s=this.studio,file=draft.source.sha256===s.draft.source.sha256?s.file:await readSampleFile(s.root,draft.source);
    await s.adopt(draft,file,{dirty});
  }
  async fork(branch){
    const s=this.studio;if(!await s.preserveWorking())return;
    const draft=branch?await branchWorking(s.root,s.draft,this.selected.value,this.branchName.value.trim()||undefined):await restoreCheckpoint(s.root,s.draft,this.selected.value);
    await this.switchTo(draft);s.status.textContent=(branch?'Branch opened':'Checkpoint restored')+' as a new Working Copy · '+draft.name;
  }
  async newCopy(){
    const s=this.studio;if(!await s.preserveWorking())return;
    const d=s.draft;
    const next=createWorking({...d,name:d.name+' copy'});
    await this.switchTo(next);s.status.textContent='New Working Copy · '+next.name;
  }
  async discardDraft(){
    const s=this.studio;if(!s.confirmDiscard())return;
    const next=await discardWorking(s.root,s.draft);
    await this.switchTo(next,{dirty:false});await s.browser.refreshWorking();s.status.textContent='Working reset · '+next.name;
  }
  async startOriginal(){
    const s=this.studio;if(!s.confirmDiscard())return;
    await this.switchTo(await startFromOriginal(s.root,s.draft));s.status.textContent='New Working Copy from Original.';
  }
  async republish(){
    const s=this.studio,d=s.draft,revision=this.revision.valueAsNumber;
    if(!Number.isInteger(revision)||revision<1||revision>=d.baseRef.revision)throw Error('Choose an earlier Official revision.');
    const ref=await repromoteWorking(s.root,d,revision,{player:s.player});
    s.draft=updateWorking(d,{baseRef:ref});s.dirty=true;await s.browser.page();
    s.status.textContent='Official r'+revision+' re-promoted as r'+ref.revision+'.';
  }
  async versionWav(key,signal){return (await this.versionAudio(key,signal)).file;}
  async versionAudio(key,signal){
    const s=this.studio,d=s.draft,root=s.root;
    if(key==='original'){
      if(!d.source.source)return {file:s.file,sample:d.source};
      const original=await startFromOriginal(root,d);
      if(s.originalFile?.hash===original.source.sha256)return {file:s.originalFile.file,sample:original.source};
      const file=await readSampleFile(root,original.source,{signal});
      if(s.root===root)s.originalFile={hash:original.source.sha256,file};
      return {file,sample:original.source};
    }
    if(key==='rendered')return {file:await readSampleFile(root,d.rendered,{signal}),sample:d.rendered};
    let version=d;
    if(key==='official')version=await workingFromRef(root,d.baseRef);
    else if(key.startsWith('checkpoint:'))version=await checkpointWorking(root,d,key.slice(11));
    signal?.throwIfAborted();
    if(version.rendered)return {file:await readSampleFile(root,version.rendered,{signal}),sample:version.rendered};
    const file=version.source.sha256===d.source.sha256?s.file:await readSampleFile(root,version.source,{signal});
    // For a mapped instrument this visual audition represents its reference sample.
    if(version.instrument)return {file,sample:version.source,reference:true};
    if(!version.recipe.some(operation=>!operation.bypass)){
      const [start,end]=version.selection;
      if(start===0&&end===version.source.frames)return {file,sample:version.source};
      return {file:rangeWav(file,await inspectWav(file,{anyRate:true}),{start,end}),sample:null};
    }
    return {file:await previewWorkingWav(root,version,{signal}),sample:null};
  }
  async listen(select,side){
    const s=this.studio,audio=await this.versionAudio(select.value);
    await s.audition.play(audio.file);
    s.status.textContent='Listening '+side+' · '+select.selectedOptions[0].textContent+(audio.reference?' · reference sample':'');
  }
  async play(select,side){
    const s=this.studio,{draft,player,root}=s,key=select.value;
    await s.playPrepared(async()=>{
      if(key==='official')return prepareSampler(player,root,draft.baseRef);
      let version=draft;
      if(key==='original')version=await startFromOriginal(root,draft);
      else if(key==='rendered')version=createWorking({libraryId:draft.libraryId,source:draft.rendered,rootNote:draft.rootNote});
      else if(key.startsWith('checkpoint:'))version=await checkpointWorking(root,draft,key.slice(11));
      if(version.instrument||version.rendered||(version.source.sampleRate===44100&&version.recipe.every(op=>op.bypass)&&
          version.selection[0]===0&&version.selection[1]===version.source.frames))return prepareWorking(player,root,version);
      return prepareSamplePreview(player,await previewWorkingWav(root,version),version.rootNote);
    },side+' · '+select.selectedOptions[0].textContent);
  }
  windowChanged(){
    this.observer.disconnect();this.observer=this.makeObserver();
    for(const card of this.cards.values())if(card.identity&&!card.loaded)this.observer.observe(card.node);
  }
  draw(card){
    card.loaded=true;card.scan=new AbortController();const signal=card.scan.signal;
    void this.versionWav(card.id,signal).then(wav=>{
      signal.throwIfAborted();return card.mini.show(wav);
    }).catch(error=>{if(!signal.aborted)card.message.textContent=error.message;});
  }
  showCard(container,id,title,detail,identity){
    let card=this.cards.get(id);
    if(!card){
      const node=el('button','ww-sampler-version-card'),heading=el('strong'),label=el('small','ww-muted'),message=el('small','ww-muted');
      node.type='button';node.dataset.version=id;
      node.onclick=()=>this.studio.run(()=>this.studio.showWave(id));
      const mini=createMiniWaveform();mini.node.setAttribute('aria-label',title+' waveform');
      node.append(heading,label,mini.node,message);
      card={id,node,heading,label,mini,message};this.cards.set(id,card);container.append(node);
    }
    card.node.disabled=!identity;card.node.setAttribute('aria-label','View waveform for '+title);
    card.node.setAttribute('aria-pressed',String(this.studio.displayMode===id));
    card.heading.textContent=title;card.label.textContent=detail||'';
    if(card.identity!==identity){
      card.scan?.abort();card.mini.clear();card.message.textContent='';card.identity=identity;card.loaded=false;
      this.observer.unobserve(card.node);
      if(identity)this.observer.observe(card.node);
    }
    return card;
  }
  sync(draft){
    this.node.hidden=this.versions.hidden=!draft;
    const links=[...(draft?.history?.checkpoints||[])].reverse();
    const reference=draft?.instrument?' · reference sample':'';
    this.latest.hidden=!links.length;
    const entries=[['working','Working'],['original','Original']];
    if(draft?.rendered)entries.push(['rendered','Rendered Derivative']);
    if(draft?.baseRef)entries.push(['official','Official r'+draft.baseRef.revision]);
    entries.push(...links.map(item=>[checkpointKey(item.id),item.name]));
    const waveViews=[['source','Source selection'],...entries.map(([id,label])=>[id,id==='working'?'Working result':label])];
    if(draft?.instrument)waveViews.push(['region','Selected region WAV']);
    const selects=[[this.studio.waveMode,waveViews,'source'],[this.compareA,entries,'original'],[this.compareB,entries,'working'],
      [this.selected,links.map(item=>[item.id,item.name]),links[0]?.id]];
    for(const [control,options,fallback] of selects){
      const signature=JSON.stringify(options);
      if(control.dataset.options===signature)continue;
      const previous=control.value;
      control.replaceChildren(...options.map(([value,label])=>new Option(label,value)));
      control.value=options.some(([value])=>value===previous)?previous:(fallback||'');
      control.dataset.options=signature;
    }
    this.undo.disabled=!draft?.history?.undo?.length;this.redo.disabled=!draft?.history?.redo?.length;
    this.restore.disabled=this.branch.disabled=this.branchName.disabled=this.selected.disabled=!links.length;
    const max=(draft?.baseRef?.revision||1)-1;
    if(this.revision.max!==String(max)){this.revision.max=max;this.revision.value=max||'';}
    this.repromote.disabled=this.revision.disabled=max<1;
    const keep=new Set();
    if(draft){
      const d=draft,source=d.source;
      const key=JSON.stringify([source.sha256,d.selection,d.recipe,d.rendered?.sha256,d.instrument?.id]);
      const active=this.showCard(this.versions,'working','Working',d.name,key);keep.add(active.id);
      if(d.instrument)active.label.textContent=d.name+' · reference sample';
      const original=this.showCard(this.versions,'original','Original',source.source?.path||source.path,d.libraryId+':'+(source.source?.sha256||source.sha256));keep.add(original.id);
      const official=this.showCard(this.versions,'official','Official',d.baseRef?'Revision '+d.baseRef.revision+reference:'Unpublished',d.baseRef&&JSON.stringify(d.baseRef));keep.add(official.id);
      for(const item of links.slice(0,3)){
        const id=checkpointKey(item.id),card=this.showCard(this.latest,id,item.name,'Checkpoint',id);
        keep.add(id);this.latest.append(card.node);
      }
    }
    for(const [id,card] of this.cards)if(!keep.has(id)){
      this.observer.unobserve(card.node);card.scan?.abort();card.mini.clear();card.node.remove();this.cards.delete(id);
    }
    const listKey=JSON.stringify(links);
    if(this.list.dataset.items!==listKey){
      this.list.replaceChildren(...links.map(item=>el('li','',item.name+' · '+new Date(item.createdAt).toLocaleString())));
      if(!links.length)this.list.append(el('li','ww-muted','No checkpoints yet'));
      this.list.dataset.items=listKey;
    }
  }
}
