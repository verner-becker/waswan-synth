// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {librarySetting} from './tone-bank.js';
import {importOriginal,initializeLibrary,inspectSample,readLibrary,readSampleFile} from './sampler-library.js';
import {createWorking,updateWorking,openWorking,saveWorking,renderWorking,promoteWorking,workingFromRef,prepareWorking,previewWorkingWav,continueFromRendered} from './sampler-working.js';
import {runOffline} from './sampler-offline.js';
import {prepareSamplePreview,prepareSampler,setLiveSampler} from './sampler.js';
import {createSamplerAudition} from './ui-sampler-audition.js';
import {SamplerHistory} from './ui-sampler-history.js';
import {createProcessingStack} from './ui-sampler-processing.js';
import {createSamplerWaveform} from './ui-sampler-waveform.js';
import {SamplerLibraryBrowser} from './ui-sampler-library.js';

const preferenceKey='waswan.sampler.studio.sections.v1';
const leaf=path=>path.split('/').at(-1);
const stem=name=>name.replace(/\.wav$/iu,'');
const routeIdle='Part A · Synth keyboard';
function readPreferences(){
  try{return JSON.parse(localStorage.getItem(preferenceKey))||{};}catch{return {};}
}
function field(parent,label,type,options={}){
  const node=el('label','',label),input=el('input');
  Object.assign(input,{type,...options});input.setAttribute('aria-label',label);node.append(input);parent.append(node);return input;
}

export class SamplerStudio {
  constructor({bridge,player,liveConflict,assignOfficial}) {
    Object.assign(this,{bridge,player,liveConflict,assignOfficial});
    this.prefs=readPreferences();this.sections=new Map();
    this.node=Panel('Sampler Studio');this.node.classList.add('ww-sampler-studio');
    this.heading=this.node.querySelector('h2');this.heading.tabIndex=-1;
    this.status=el('p','ww-sampler-status','Choose your Samples folder to open a Working Copy or import a WAV.');
    this.status.setAttribute('role','status');this.node.append(this.status);
    this.body=el('fieldset','ww-sampler-layout');this.node.append(this.body);
    const library=this.section('Library & Metadata',true);
    this.browser=new SamplerLibraryBrowser(this);library.append(this.browser.node);this.body.append(library);
    this.main=el('div','ww-sampler-main');this.body.append(this.main);
    const sample=this.section('Sample Editor',true);
    this.fileInput=el('input');this.fileInput.type='file';this.fileInput.accept='.wav,audio/wav';this.fileInput.hidden=true;this.fileInput.setAttribute('aria-label','Import WAV');
    this.fileInput.onchange=()=>{const file=this.fileInput.files[0];this.fileInput.value='';if(file)void this.run(()=>this.importFile(file));};
    this.importButton=action('Import WAV…',()=>this.fileInput.click(),'ww-primary');
    this.back=this.button('Back to source take',()=>this.openSource());
    const sampleTools=el('div','ww-sampler-actions');sampleTools.append(this.importButton,this.fileInput,this.back);
    const modeWrap=el('label','','Editor audio ');this.waveMode=el('select');
    this.waveMode.setAttribute('aria-label','Editor audio');
    this.waveMode.append(new Option('Source selection','source'),new Option('Working result','working'));
    this.waveMode.onchange=()=>this.run(()=>this.showWave(this.waveMode.value));
    modeWrap.append(this.waveMode);sampleTools.append(modeWrap);
    this.sourceLabel=el('p','ww-muted','No WAV open');
    this.audition=createSamplerAudition(()=>this.bridge.getAudio());
    this.wave=createSamplerWaveform({audition:this.audition,onSelection:({start,end})=>{
      if(this.draft&&!this.busy&&this.displayMode==='source'&&!this.draft.instrument)this.change({selection:[start,end]});
    },onCrop:args=>this.run(()=>this.crop(args))});
    sample.append(sampleTools,this.sourceLabel,this.wave.node);
    const processing=this.section('Processing Stack',true);
    this.stack=createProcessingStack({change:recipe=>this.change({recipe}),run:fn=>this.run(fn),
      audition:this.audition,preview:through=>previewWorkingWav(this.root,this.draft,{through})});
    processing.append(this.stack.node);
    const versions=this.section('Versions & History',true);
    this.identity=el('div','ww-sampler-fields');
    this.name=field(this.identity,'Working name','text',{maxLength:128});
    this.note=field(this.identity,'Root note (MIDI)','number',{min:0,max:127,step:1});
    this.name.onchange=()=>void this.run(()=>this.change({name:this.name.value.trim()}));
    this.note.onchange=()=>void this.run(()=>this.change({rootNote:this.note.valueAsNumber}));
    this.analyze=this.button('Suggest root note',()=>this.analyzeRoot());
    this.accept=this.button('Use suggested root',()=>this.change({rootNote:this.suggestion}));
    this.pitchInfo=el('span','ww-muted');this.identity.append(this.analyze,this.accept,this.pitchInfo);
    this.versionLabel=el('p','ww-sampler-versions');
    this.save=this.button('Save Working',()=>this.saveDraft());this.render=this.button('Render Version',()=>this.renderDraft());
    this.continueRender=this.button('Continue editing rendered version',async()=>{
      if(!await this.preserveWorking())return;
      const next=continueFromRendered(this.draft);
      await this.adopt(next,await readSampleFile(this.root,next.source),{dirty:true});
      this.status.textContent='New Working Copy from rendered WAV · '+next.name;
    });
    this.promote=this.button('Promote to Official',()=>this.promoteDraft());this.promote.classList.add('ww-primary');
    this.play=this.button('Play on Synth keyboard',()=>this.assignLive());
    this.release=this.button('Release Synth keyboard',()=>this.releaseLive());
    this.route=el('strong','ww-sampler-route',routeIdle);
    const versionTools=el('div','ww-sampler-actions');versionTools.append(this.save,this.render,this.continueRender,this.promote);
    const playback=el('div','ww-sampler-actions');
    const source=el('label','','Keyboard source ');this.keyboardSource=el('select');
    this.keyboardSource.append(new Option('Working Copy','working'),new Option('Official revision','official'));
    source.append(this.keyboardSource);
    this.assignTrack=this.button('Assign Official to selected DAW track',async()=>{
      const trackName=await this.assignOfficial(()=>prepareSampler(this.player,this.root,this.draft.baseRef));
      this.status.textContent='Official r'+this.draft.baseRef.revision+' assigned to DAW track · '+trackName;
    });
    playback.append(source,this.play,this.release,this.route);versionTools.append(this.assignTrack);
    this.history=new SamplerHistory(this);
    sample.append(this.history.versions,this.history.latest);
    versions.append(this.versionLabel,this.identity,versionTools,playback,this.history.node);
    this.main.append(sample,processing,versions);
    for(const title of ['Mapping Editor','Instrument Builder','Sound Fusion','Advanced Tools']){
      const section=this.section(title,false);section.firstElementChild.append(el('small','ww-muted','Planned'));this.main.append(section);
    }
    this.sync();
    addEventListener('beforeunload',event=>{if(this.dirty){event.preventDefault();event.returnValue='';}});
  }
  button(label,fn){return action(label,()=>void this.run(fn));}
  section(title,initial){
    const box=el('details','ww-sampler-section');
    box.append(el('summary','',title));box.open=this.prefs[title]??initial;
    box.ontoggle=()=>{this.prefs[title]=box.open;try{localStorage.setItem(preferenceKey,JSON.stringify(this.prefs));}catch{}};
    this.sections.set(title,box);return box;
  }
  focus(){this.heading.focus({preventScroll:true});}
  async run(fn) {
    if(this.busy)return;
    this.busy=true;this.body.disabled=true;this.body.inert=true;this.node.setAttribute('aria-busy','true');
    try{
      const result=await fn();
      if(this.displayMode==='working'&&this.resultStale)await this.showWave('working');
      return result;
    }
    catch(error){if(error.name!=='AbortError')this.status.textContent=error.message||String(error);}
    finally{this.busy=false;this.body.disabled=false;this.body.inert=false;this.node.removeAttribute('aria-busy');this.sync();}
  }
  activate(){
    if(this.busy)return;
    void this.run(async()=>{
      const root=await librarySetting(undefined,'sampleLibrary');
      if(!root)return;
      if(this.root&&await root.isSameEntry(this.root)){
        if(!this.library&&await root.queryPermission({mode:'readwrite'})==='granted')await this.bindFolder(root);
        return;
      }
      if(this.draft){this.status.textContent='Samples folder changed in Instrument setup. Choose the new folder here after saving your Working Copy.';return;}
      await this.bindFolder(root);
    });
  }
  async bindFolder(root,{initialize=false}={}){
    const allowed=await root.queryPermission({mode:'readwrite'})==='granted';
    let library=null;
    if(allowed){
      try{library=initialize?await initializeLibrary(root,{name:root.name}):await readLibrary(root);}
      catch(error){if(error.code!=='missing-library')throw error;}
    }
    if(!this.root||!await this.root.isSameEntry(root)){this.wave.clear();this.originalFile=null;this.draft=null;this.file=null;this.dirty=false;this.browser.reset();}
    this.root=root;this.library=library;await this.browser.refresh();
    this.status.textContent=library?'Samples folder ready · '+root.name:allowed?'Use Allow folder access to initialize this Samples folder.':'Allow read and write access to your Samples folder.';
  }
  confirmDiscard(){return !this.dirty||confirm('Discard unsaved changes to this Working Copy?');}
  async preserveWorking(){
    if(!this.dirty&&this.draft.generation)return true;
    if(!confirm('Save the current Working Copy before opening a new copy?'))return false;
    await this.saveDraft();return true;
  }
  async chooseFolder(){
    if(!this.confirmDiscard())return;
    const root=await showDirectoryPicker({id:'waswan-samples',mode:'readwrite',...(this.root?{startIn:this.root}:{})});
    if(await root.requestPermission({mode:'readwrite'})!=='granted')throw Error('Write access was denied. Choose the Samples folder again.');
    await this.bindFolder(root,{initialize:true});
    await librarySetting(root,'sampleLibrary');
  }
  async allowFolder(){
    if(await this.root.requestPermission({mode:'readwrite'})!=='granted')throw Error('Write access was denied. Use Allow folder access to retry.');
    await this.bindFolder(this.root,{initialize:true});
  }
  async adopt(draft,file,{dirty=false}={}){
    const [start,end]=draft.selection;
    if(this.file===file&&this.displayMode==='source')this.wave.setSelection({start,end});
    else await this.wave.open(file,{selection:{start,end}});
    this.resultStale=false;this.displayMode=this.waveMode.value='source';this.wave.setCropEnabled(true);
    this.draft=draft;this.file=file;this.dirty=dirty;
    if(!draft.source.source)this.originalFile={hash:draft.source.sha256,file};
    this.keyboardSource.value='working';this.clearSuggestion();this.sync();
  }
  async showWave(mode){
    const d=this.draft;
    if(mode==='working'){
      const result=await this.history.versionWav('working');
      await this.wave.open(new File([result],d.name+' · Working.wav',{type:'audio/wav'}));
    }else{
      const [start,end]=d.selection;
      await this.wave.open(this.file,{selection:{start,end}});
    }
    this.wave.setCropEnabled(mode==='source');
    this.displayMode=this.waveMode.value=mode;this.resultStale=false;
  }
  async importFile(file){
    if(!this.library)throw Error('Choose a Samples folder first.');
    if(!this.confirmDiscard())return;
    this.status.textContent='Importing original WAV…';
    const source=await importOriginal(this.root,file,'Samples/Originals/'+file.name);
    await this.adopt(createWorking({libraryId:this.library.id,source,name:stem(file.name)}),file);
    this.sections.get('Sample Editor').open=true;
    this.status.textContent='Original imported · select a range to create a sample.';
    await this.browser.page();
  }
  async crop({file,source:inputFile,start,end,sampleRate}){
    if(!this.draft||this.file!==inputFile)throw Error('The source changed. Select a range on the current WAV.');
    const source=this.draft.source;
    const selection=[start,end],name=stem(leaf(source.path))+' '+start+'–'+end;
    const path='Samples/Processed/'+source.id+'/'+start+'-'+end+'.wav';
    const clipped=await importOriginal(this.root,file,path,{name,source:{path:source.path,sha256:source.sha256},
      recipe:{version:1,operations:[{type:'trim',start,end}]},license:source.license,provenance:{sourceTake:source.path,selection,sampleRate,sourceProvenance:source.provenance}});
    await this.adopt(createWorking({libraryId:this.library.id,source:clipped,name,rootNote:this.draft.rootNote}),file,{dirty:true});
    this.status.textContent='Sample created from selection · '+name;
    await this.browser.page();
  }
  async openSource(){
    const path=this.draft.source.source?.path;
    if(path)await this.openEntry({kind:'sample',path});
  }
  async openEntry(entry){
    if(!this.confirmDiscard())return;
    let draft;
    if(entry.kind==='sample'){
      const source=await inspectSample(this.root,entry.path);
      draft=createWorking({libraryId:this.library.id,source,name:source.name||stem(leaf(entry.path))});
    }else{
      draft=await workingFromRef(this.root,{type:'sampler',libraryId:this.library.id,instrumentId:entry.id,revision:entry.revision,path:entry.path});
    }
    await this.adopt(draft,await readSampleFile(this.root,draft.source));
    this.sections.get('Sample Editor').open=true;
    if(entry.kind!=='sample')this.keyboardSource.value='official';
    this.status.textContent=entry.kind==='sample'?'Sample open · '+draft.name:'Official r'+entry.revision+' opened as a new Working Copy.';
  }
  async reopen(id){
    if(!this.confirmDiscard())return;
    const draft=await openWorking(this.root,id);
    await this.adopt(draft,await readSampleFile(this.root,draft.source));
    this.status.textContent='Working Copy reopened · '+draft.name;
  }
  clearSuggestion(){this.suggestion=null;this.pitchInfo.textContent='';}
  change(changes){
    const next=updateWorking(this.draft,changes);
    if(changes.selection||changes.recipe)this.clearSuggestion();
    if(changes.recipe||changes.selection||changes.instrument)this.resultStale=true;
    this.draft=next;this.dirty=true;this.sync();
  }
  previewWav(){return previewWorkingWav(this.root,this.draft);}
  async analyzeRoot(){
    this.status.textContent='Analyzing selected audio…';
    const {pitch}=await runOffline(await this.previewWav(),{type:'analyze'});
    this.suggestion=Number.isInteger(pitch.root)&&pitch.root>=0&&pitch.root<=127?pitch.root:null;
    this.pitchInfo.textContent=this.suggestion==null?'No stable root · '+pitch.reason:'MIDI '+pitch.root+' · '+Math.round(100*pitch.confidence)+'% confidence';
    this.status.textContent=this.pitchInfo.textContent;
  }
  async saveDraft(){
    this.draft=await saveWorking(this.root,this.draft);this.dirty=false;
    this.status.textContent='Working Copy saved · '+this.draft.name;
    await this.browser.refreshWorking();
  }
  async renderDraft(){
    this.status.textContent='Rendering version…';
    this.draft=await renderWorking(this.root,this.draft);this.dirty=true;
    this.status.textContent='Rendered Derivative · '+this.draft.rendered.path;
    await this.browser.page();
  }
  async promoteDraft(){
    const draft=this.draft,path=draft.baseRef?.path||'Instruments/'+draft.name;
    this.status.textContent='Validating and preparing Official revision…';
    const ref=await promoteWorking(this.root,draft,{path,player:this.player});
    this.draft=updateWorking(draft,{baseRef:ref});this.dirty=true;
    this.status.textContent='Official r'+ref.revision+' published · '+ref.path;
    await this.browser.page();
  }
  async assignLive(){
    const conflict=this.liveConflict();if(conflict)throw Error(conflict);
    const draft=this.draft;
    this.status.textContent='Preparing keyboard preview…';
    const official=this.keyboardSource.value==='official';
    const ref=official?await prepareSampler(this.player,this.root,draft.baseRef):
      draft.instrument||draft.rendered?await prepareWorking(this.player,this.root,draft):
      await prepareSamplePreview(this.player,await this.previewWav(),draft.rootNote);
    const changed=this.liveConflict();if(changed)throw Error(changed);
    await setLiveSampler(this.player,ref);
    this.liveName=draft.name+(official?' · Official r'+draft.baseRef.revision:' · Working');
    this.status.textContent='Play '+draft.name+' on Synth Part A. Release Synth keyboard to restore its previous sound.';
    this.updateRoute();
  }
  resetLive(){this.liveName=null;this.updateRoute();this.sync();}
  async releaseLive(){
    await setLiveSampler(this.player,null);this.resetLive();
    this.status.textContent='Sampler keyboard released.';
  }
  updateRoute(){
    this.route.textContent=this.liveName?'Part A · Sampler · '+this.liveName:routeIdle;
    this.onRouteChange?.(this.route.textContent);
  }
  sync(){
    const d=this.draft,source=d?.source;this.stack.sync(d);this.history.sync(d);
    this.waveMode.disabled=!d;this.waveMode.value=this.displayMode||'source';
    this.continueRender.disabled=!d?.rendered;
    this.importButton.disabled=!this.library;
    this.back.hidden=!source?.source?.path;
    this.sourceLabel.textContent=source?'Source · '+source.path+' · '+source.channels+' ch · '+(source.sampleRate/1000)+' kHz':'No WAV open';
    if(this.displayMode==='working'&&d)this.sourceLabel.textContent=(this.resultStale?'Working result needs refresh':'Working result')+' · local frames · '+(d.instrument?'reference sample':d.name);
    this.name.value=d?.name??'';this.note.value=d?.rootNote??60;
    for(const field of [this.name,this.note,this.save,this.render,this.analyze,this.play])field.disabled=!d;
    this.accept.hidden=this.suggestion==null;const originalPlayable=d&&d.source.sampleRate===44100&&d.recipe.every(op=>op.bypass)&&d.selection[0]===0&&d.selection[1]===d.source.frames;
    this.promote.disabled=!(d?.rendered||originalPlayable);
    this.keyboardSource.options[1].disabled=!d?.baseRef;this.keyboardSource.disabled=!d;
    this.assignTrack.disabled=!d?.baseRef;
    this.release.hidden=!this.liveName;
    if(d?.instrument){
      for(const field of [this.note,this.render,this.analyze])field.disabled=true;
      this.promote.disabled=false;
    }
    this.versionLabel.textContent=d?['Working · '+(this.dirty?'Unsaved changes':d.generation?'Saved '+d.generation:'New'),
      d.rendered?'Rendered · '+leaf(d.rendered.path):'Render pending',d.baseRef?'Official · r'+d.baseRef.revision:'Unpublished'].join('    /    '):'Open a sample to start a Working Copy.';
  }
}
