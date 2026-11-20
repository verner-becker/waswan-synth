// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {librarySetting} from './tone-bank.js';
import {importOriginal,initializeLibrary,inspectSample,readLibrary,readSampleFile} from './sampler-library.js';
import {createWorking,updateWorking,openWorking,saveWorking,renderWorking,promoteWorking,workingFromRef,prepareWorking,previewWorkingWav,continueFromRendered,startFromOriginal} from './sampler-working.js';
import {runOffline} from './sampler-offline.js';
import {prepareSamplePreview,prepareSampler,setLiveSampler,mapSample} from './sampler.js';
import {createSamplerAudition} from './ui-sampler-audition.js';
import {SamplerHistory} from './ui-sampler-history.js';
import {createProcessingStack} from './ui-sampler-processing.js';
import {createSamplerWaveform} from './ui-sampler-waveform.js';
import {validateInstrument} from './sampler-instrument.js';
import {SamplerFusion} from './ui-sampler-fusion.js';
import {createSamplerInterchange} from './ui-sampler-interchange.js';
import {SamplerBuilder} from './ui-sampler-builder.js';
import {createSamplerMapping} from './ui-sampler-mapping.js';
import {createSamplerGroupInspector} from './ui-sampler-groups.js';
import {SamplerLibraryBrowser} from './ui-sampler-library.js';

const preferenceKey='waswan.sampler.studio.sections.v1';
const leaf=path=>path.split('/').at(-1);
const stem=name=>name.replace(/\.wav$/iu,'');
const routeIdle='Part A · Synth keyboard';
function readPreferences(key){
  try{return JSON.parse(localStorage.getItem(key))||{};}catch{return {};}
}
function field(parent,label,type,options={}){
  const node=el('label','',label),input=el('input');
  Object.assign(input,{type,...options});input.setAttribute('aria-label',label);node.append(input);parent.append(node);return input;
}

export class SamplerStudio {
  constructor({bridge,player,daw,liveConflict,assignOfficial}) {
    Object.assign(this,{bridge,player,liveConflict,assignOfficial});
    this.preferenceKey=preferenceKey;this.prefs=readPreferences(this.preferenceKey);this.sections=new Map();this.defaults=new Map();
    this.node=Panel('Sampler Studio');this.node.classList.add('ww-sampler-studio');
    this.detachButton=action('Open Sampler in new window',()=>this.openWindow());
    this.node.firstElementChild.append(this.detachButton);
    this.heading=this.node.querySelector('h2');this.heading.tabIndex=-1;
    this.status=el('p','ww-sampler-status','Choose your Samples folder to open a Working Copy or import a WAV.');
    this.status.setAttribute('role','status');this.node.append(this.status);
    this.body=el('fieldset','ww-sampler-layout');this.node.append(this.body);
    const library=this.section('Library & Metadata',true);
    this.browser=new SamplerLibraryBrowser(this);this.interchange=createSamplerInterchange(this);library.append(this.browser.node,this.interchange.node);this.body.append(library);
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
    this.wave=createSamplerWaveform({audition:this.audition,onMarkers:({file,markers})=>{
      if(this.draft&&!this.busy&&this.displayMode==='source'&&file===this.file)this.change({sliceMarkers:markers});
    },onSelection:({start,end})=>{
      if(this.draft&&!this.busy&&this.displayMode==='source'&&!this.draft.instrument)this.change({selection:[start,end]});
    },onCrop:args=>this.run(()=>this.crop(args)),onSlices:args=>this.run(()=>this.useSlices(args)),onLoop:args=>this.run(()=>this.useLoop(args))});
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
    const source=el('label','','Keyboard source ');this.keyboardSource=el('select');this.keyboardSource.setAttribute('aria-label','Keyboard source');
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
    const mapping=this.section('Mapping Editor',false),builder=this.section('Instrument Builder',false);
    const controls={change:(model,options)=>this.changeInstrument(model,options),
      select:id=>this.selectRegion(id),run:fn=>this.run(fn)};
    this.map=createSamplerMapping(controls);this.groups=createSamplerGroupInspector(controls);
    this.builder=new SamplerBuilder(this);this.builder.paint();
    this.editRegionWave=this.button('Open selected region waveform',()=>this.showWave('region'));
    mapping.append(this.map.node,this.editRegionWave);builder.append(this.builder.node,this.groups.node);
    this.main.append(mapping,builder);
    const fusion=this.section('Sound Fusion',false);this.fusion=new SamplerFusion(this,daw);
    fusion.append(this.fusion.node);this.main.append(fusion);
    const advanced=this.section('Advanced Tools',false);
    const waveTools=this.wave.node.querySelector('.ww-wave-tools');advanced.append(waveTools);
    sampleTools.append(action('Advanced waveform tools',()=>{advanced.open=true;waveTools.open=true;waveTools.querySelector('summary').focus();}));
    sample.after(advanced);
    this.subsections=new WeakMap();
    this.node.addEventListener('toggle',event=>{
      const title=this.subsections.get(event.target);
      if(title)this.storeExpansion(title,event.target.open);
    },true);
    this.sync();
    addEventListener('beforeunload',event=>{if(this.dirty){event.preventDefault();event.returnValue='';}});
  }
  button(label,fn){return action(label,()=>void this.run(fn));}
  section(title,initial){
    this.defaults.set(title,initial);const box=el('details','ww-sampler-section');
    box.append(el('summary','',title));box.open=this.prefs[title]??initial;
    box.ontoggle=()=>this.storeExpansion(title,box.open);
    this.sections.set(title,box);return box;
  }
  storeExpansion(key,open){
    this.prefs[key]=open;
    try{localStorage.setItem(this.preferenceKey,JSON.stringify(this.prefs));}catch{}
  }
  syncSubsections(reset=false){
    for(const box of this.node.querySelectorAll('details details')){
      const summary=box.querySelector(':scope > summary');
      if(!summary)continue;
      const title='Subsection · '+summary.textContent;
      if(!reset&&this.subsections.get(box)===title)continue;
      this.subsections.set(box,title);
      if(!this.defaults.has(title))this.defaults.set(title,box.open);
      box.open=this.prefs[title]??this.defaults.get(title);
    }
  }
  setLayout(layout){
    for(const [title,box] of this.sections)this.prefs[title]=box.open;
    for(const box of this.node.querySelectorAll('details details')){
      const key=this.subsections.get(box);if(key)this.prefs[key]=box.open;
    }
    try{localStorage.setItem(this.preferenceKey,JSON.stringify(this.prefs));}catch{}
    this.preferenceKey=layout==='window'?preferenceKey+'.window':preferenceKey;
    this.prefs=readPreferences(this.preferenceKey);
    for(const [title,node] of this.sections)node.open=this.prefs[title]??this.defaults.get(title);
    this.syncSubsections(true);
  }
  focus(){this.heading.focus({preventScroll:true});}
  async run(fn,activePanel) {
    if(this.busy)return;
    this.busy=true;this.body.disabled=this.body.inert=!activePanel;
    if(activePanel)for(const panel of this.sections.values())panel.inert=!panel.contains(activePanel);
    this.node.setAttribute('aria-busy','true');
    try{
      const result=await fn();
      if(this.displayMode==='working'&&this.resultStale)await this.showWave('working');
      return result;
    }
    catch(error){if(error.name!=='AbortError')this.status.textContent=error.message||String(error);}
    finally{if(activePanel)for(const panel of this.sections.values())panel.inert=false;
      this.busy=false;this.body.disabled=false;this.body.inert=false;this.node.removeAttribute('aria-busy');this.sync();}
  }
  activate(){
    if(this.busy)return;
    return this.run(async()=>{
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
    if(!this.root||!await this.root.isSameEntry(root)){
      if(this.fusion.lease)throw Error('Release the Fusion keyboard before changing its sample library.');
      this.fusion.reset();this.wave.clear();this.builder.reset();this.originalFile=null;this.draft=null;this.file=null;this.dirty=false;this.browser.reset();}
    this.root=root;this.library=library;await this.browser.refresh();
    this.status.textContent=library?'Samples folder ready · '+root.name:allowed?'Use Allow folder access to initialize this Samples folder.':'Allow read and write access to your Samples folder.';
  }
  confirmDiscard(){return !this.dirty||this.node.ownerDocument.defaultView.confirm('Discard unsaved changes to this Working Copy?');}
  async preserveWorking(){
    if(!this.dirty&&this.draft.generation)return true;
    if(!this.node.ownerDocument.defaultView.confirm('Save the current Working Copy before opening a new copy?'))return false;
    await this.saveDraft();return true;
  }
  async chooseFolder(){
    if(!this.confirmDiscard())return;
    const root=await this.node.ownerDocument.defaultView.showDirectoryPicker({id:'waswan-samples',mode:'readwrite',...(this.root?{startIn:this.root}:{})});
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
    const markers=draft.sliceMarkers??[];
    if(this.file===file&&this.displayMode==='source'){
      this.wave.setSelection({start,end});this.wave.setMarkers(markers);
    }else await this.wave.open(file,{selection:{start,end},markers});
    this.resultStale=false;this.displayMode=this.waveMode.value='source';this.wave.setCropEnabled(true);
    this.draft=draft;this.file=file;this.displayFile=file;this.displaySample=draft.source;this.dirty=dirty;
    if(!draft.source.source)this.originalFile={hash:draft.source.sha256,file};
    this.keyboardSource.value='working';this.clearSuggestion();this.sync();
  }
  async showWave(mode){
    const d=this.draft;
    const historical=mode!=='source';
    let file=this.file,sample=d.source;
    if(mode==='region'){
      const region=d.instrument?.regions.find(r=>r.id===this.regionId);
      if(!region)throw Error('Select a mapped region.');
      sample=d.instrument.samples.find(s=>s.id===region.sample);
      file=await readSampleFile(this.root,sample);
      await this.wave.open(file,{selection:{start:region.frames[0],end:region.frames[1]},loop:region.loop});
      this.sections.get('Sample Editor').open=true;
    }else if(historical){
      const result=await this.history.versionAudio(mode);
      const label=this.waveMode.querySelector('option[value="'+CSS.escape(mode)+'"]')?.textContent||mode;
      file=new File([result.file],d.name+' · '+label+'.wav',{type:'audio/wav'});
      sample=result.sample;
      await this.wave.open(file);
    }else{
      const [start,end]=d.selection;
      await this.wave.open(file,{selection:{start,end},markers:d.sliceMarkers??[]});
    }
    this.displayFile=file;this.displaySample=sample;
    this.wave.setCropEnabled(!historical);
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
    const meaningfulEdit=this.draft.history?.undo?.some(delta=>Object.keys(delta).some(key=>key!=='selection'));
    if(this.dirty&&meaningfulEdit&&!await this.preserveWorking())return;
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
    if(!this.draft.source.source)return;
    const original=await startFromOriginal(this.root,this.draft);
    await this.openEntry({kind:'sample',path:original.source.path});
  }
  async openEntry(entry){
    this.interchange.select(entry);
    if(!this.confirmDiscard())return;
    let draft;
    if(entry.kind==='sample'){
      const source=await inspectSample(this.root,entry.path);
      draft=createWorking({libraryId:this.library.id,source,name:source.name||stem(leaf(entry.path))});
    }else{
      draft=await workingFromRef(this.root,{type:'sampler',libraryId:this.library.id,instrumentId:entry.id,revision:entry.revision,path:entry.path});
    }
    await this.adopt(draft,await readSampleFile(this.root,draft.source));
    this.sections.get(draft.instrument?'Mapping Editor':'Sample Editor').open=true;
    if(entry.kind!=='sample')this.keyboardSource.value='official';
    this.status.textContent=entry.kind==='sample'?'Sample open · '+draft.name:'Official r'+entry.revision+' opened as a new Working Copy.';
  }
  async reopen(id){
    if(!this.confirmDiscard())return;
    const draft=await openWorking(this.root,id);
    await this.adopt(draft,await readSampleFile(this.root,draft.source));
    this.status.textContent='Working Copy reopened · '+draft.name;
  }
  displayedAsset(file){
    if(file!==this.displayFile||!this.displaySample)throw Error('Render this Working version and open the rendered WAV to use these frames.');
    return this.displaySample;
  }
  useSlices({file,markers}){
    const sample=this.displayedAsset(file);
    if(markers.length>15)throw Error('Use up to 15 markers for a 16-pad kit.');
    if(this.builder.items.some(i=>i.sample.id!==sample.id)&&!this.node.ownerDocument.defaultView.confirm('Replace the builder recordings with this sliced sample?'))return;
    this.builder.reset();this.builder.add(sample);this.builder.markers.value=markers.join(', ');
    const panel=this.sections.get('Instrument Builder');panel.open=true;
    const slices=this.builder.node.querySelector('.ww-sampler-slices');slices.open=true;this.builder.sliced.focus();
    this.status.textContent='Slice markers ready · '+(markers.length+1)+' pads.';
  }
  async useLoop({file,start,end,mode,crossfade}){
    const sample=this.displayedAsset(file),d=this.draft;
    if(sample.sampleRate!==44100)throw Error('Render at 44.1 kHz and open the rendered WAV before mapping a loop.');
    const model=d.instrument?structuredClone(d.instrument):mapSample(sample,d.rootNote,{name:d.name});
    const region=d.instrument?model.regions.find(r=>r.id===this.regionId):model.regions[0];
    if(region?.sample!==sample.id)throw Error('The displayed WAV must match the selected region.');
    if(region.trigger==='release')throw Error('Choose an attack region for a sustain loop.');
    region.mode='gate';region.loop={start,end,mode,crossfade};validateInstrument(model);
    if(d.instrument)this.changeInstrument(model);
    else{
      if(this.dirty&&!await this.preserveWorking())return;
      const draft=createWorking({libraryId:d.libraryId,source:sample,name:d.name,rootNote:d.rootNote,instrument:model});
      await this.adopt(draft,await readSampleFile(this.root,sample),{dirty:true});
    }
    this.wave.setLoop?.(region.loop);this.status.textContent='Region loop applied · '+start+'–'+end+' frames.';
  }
  clearSuggestion(){this.suggestion=null;this.pitchInfo.textContent='';}
  selectRegion(id){
    if(!this.draft?.instrument?.regions.some(r=>r.id===id))return;
    this.regionId=id;this.syncMap();
  }
  changeInstrument(model,{regionId=this.regionId}={}){
    const checked=validateInstrument(model);
    this.regionId=regionId;this.change({instrument:checked});
  }
  syncMap(){
    const model=this.draft?.instrument;
    if(!model?.regions.some(r=>r.id===this.regionId))this.regionId=model?.regions[0]?.id??null;
    const mapping=this.sections.get('Mapping Editor');
    if(model&&this.main.firstElementChild!==mapping)this.main.prepend(mapping);
    else if(!model&&this.main.firstElementChild===mapping)this.sections.get('Instrument Builder').before(mapping);
    this.editRegionWave.disabled=!model;
    const region=model?.regions.find(r=>r.id===this.regionId);
    const loop=region?.sample===this.displaySample?.id?region?.loop:null;
    const loopKey=JSON.stringify([this.regionId,loop]);
    if(this.loopKey!==loopKey||this.loopFile!==this.displayFile){this.wave.setLoop(loop);this.loopKey=loopKey;this.loopFile=this.displayFile;}
    this.builder.sync();this.map.sync(model??null,this.regionId);this.groups.sync(model??null,this.regionId);this.syncSubsections();
  }
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
    const draft=this.draft,path=draft.baseRef?.path||(draft.instrument?.kind==='kit'?'Kits/':'Instruments/')+draft.name;
    this.status.textContent='Validating and preparing Official revision…';
    const ref=await promoteWorking(this.root,draft,{path,player:this.player});
    this.draft=updateWorking(draft,{baseRef:ref});this.dirty=true;
    this.status.textContent='Official r'+ref.revision+' published · '+ref.path;
    await this.browser.page();
  }
  async assignLive(official=this.keyboardSource.value==='official'){
    const draft=this.draft;
    const prepare=()=>official?prepareSampler(this.player,this.root,draft.baseRef):
      draft.instrument||draft.rendered?prepareWorking(this.player,this.root,draft):
      this.previewWav().then(wav=>prepareSamplePreview(this.player,wav,draft.rootNote));
    await this.playPrepared(prepare,draft.name+(official?' · Official r'+draft.baseRef.revision:' · Working'));
  }
  async playPrepared(prepare,label){
    const conflict=this.liveConflict();if(conflict)throw Error(conflict);
    this.status.textContent='Preparing keyboard preview…';
    const ref=await prepare();
    const changed=this.liveConflict();if(changed)throw Error(changed);
    await setLiveSampler(this.player,ref);
    this.liveName=label;this.release.hidden=false;
    this.status.textContent='Play '+label+' on Synth Part A. Release Synth keyboard to restore its previous sound.';
    this.updateRoute();
  }
  resetLive(){this.liveName=null;this.updateRoute();this.sync();}
  async releaseLive(){
    await setLiveSampler(this.player,null);this.resetLive();
    this.status.textContent='Sampler keyboard released.';
  }
  updateRoute(){
    this.route.textContent=this.liveName?'Part A · Sampler · '+this.liveName:routeIdle;
    this.onRouteChange?.(this.route.textContent);this.updatePlayers?.();
  }
  sync(){
    const d=this.draft,source=d?.source;this.stack.sync(d);this.history.sync(d);this.syncMap();this.fusion.sync();this.interchange.sync();this.updatePlayers?.();
    this.waveMode.disabled=!d;this.waveMode.value=this.displayMode||'source';
    this.continueRender.disabled=!d?.rendered;
    this.importButton.disabled=!this.library;
    this.back.hidden=!source?.source?.path;
    this.sourceLabel.textContent=source?'Source · '+source.path+' · '+source.channels+' ch · '+(source.sampleRate/1000)+' kHz':'No WAV open';
    if(d&&this.displayMode&&this.displayMode!=='source')this.sourceLabel.textContent=(this.waveMode.selectedOptions[0]?.textContent||'Version')+' · local frames';
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
