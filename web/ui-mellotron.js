// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {librarySetting} from './tone-bank.js';
import {preparePair,rehearsalBanks,scanTapeFolder} from './mellotron-library.js';
import {tapeDefaults,tapeControls,validTapeSettings} from './mellotron-settings.js';

export class MellotronPanel {
  constructor(request){
    this.request=request;this.settings=tapeDefaults();this.revision=0;
    this.node=el('details','ww-panel ww-tapes');
    this.node.append(el('summary','','Mellotron · Part A'));
    this.source=el('small','ww-muted');
    this.pickers=el('fieldset','ww-tape-pickers');
    this.instrument=el('select');this.layer=el('select');
    this.field('Instrument',this.instrument,this.pickers);
    this.field('Layer',this.layer,this.pickers);
    this.instrument.onchange=this.layer.onchange=()=>this.applySelection();
    this.fields=el('fieldset','ww-tape-actions');
    this.play=action('Play selection',()=>{
      if(!this.sameSelection())return this.applySelection();
      return this.run(async()=>{
        await this.request('daw-tape-live',{enabled:true,settings:this.settings});
        this.live=true;this.update();
      });
    },'ww-primary');
    this.switch=action('Use Synth on Part A',()=>this.run(async()=>{
      await this.request('daw-tape-live',{enabled:false,settings:this.settings});
      this.live=false;this.update();
    }));
    this.allow=action('Allow folder access',()=>this.run(()=>this.reopenFolder()));
    this.openLibrary=action('Open library folder…',()=>this.run(()=>this.choose()));
    this.fields.append(this.play,this.switch,this.allow,this.openLibrary);
    this.advanced=el('details');
    this.advanced.append(el('summary','','Tape settings and library'));
    const openFolder=action('Open tape folder',()=>this.run(()=>this.choose()));
    openFolder.disabled=!globalThis.showDirectoryPicker;
    const rehearsal=action('Use rehearsal instruments',()=>this.run(()=>{
      this.folder=null;this.populate(rehearsalBanks);
    }));
    this.savedFolder=action('Use saved tape folder',()=>this.run(()=>this.reopenFolder()));
    this.reload=action('Reload from disk',()=>this.applySelection());
    this.advanced.append(openFolder,this.savedFolder,rehearsal,this.reload);
    this.controls=new Map();
    const group=el('div','ww-tape-controls');this.advanced.append(group);
    for(const [key,label,min,max,value] of tapeControls){
      const input=el('input');input.type=max===1?'checkbox':'number';input.min=min;input.max=max;input.value=value;
      this.field(label,input,key==='mix'?this.pickers:group);
      this.controls.set(key,input);
      input.onchange=()=>{
        const settings={...this.settings,[key]:max===1?Number(input.checked):input.valueAsNumber};
        this.run(async()=>{
          if(!validTapeSettings(settings))throw Error('Choose a value between '+min+' and '+max+'.');
          if(this.loaded)await this.request('daw-tape-live',{enabled:this.live,settings});
          this.settings=settings;if(this.loaded)await this.save();
        });
      };
    }
    this.fields.append(this.advanced);
    this.status=el('p','ww-tape-status');this.status.setAttribute('role','status');
    this.feedback=el('p','ww-muted');this.feedback.setAttribute('role','status');
    const strip=el('div','ww-tape-strip'),info=el('div','ww-tape-info');
    info.append(this.source,this.status);
    strip.append(info,this.pickers,this.fields);
    this.node.append(strip,this.feedback);
    this.populate(rehearsalBanks);
    this.initialized=this.restoreLibrary();
  }
  field(name,input,parent){
    const label=el('label','',name);input.setAttribute('aria-label',name);label.append(input);parent.append(label);
  }
  populate(names,selected=[]){
    this.names=names;
    this.instrument.replaceChildren(new Option(names.length?'Choose an instrument…':'No instruments found',''),...names.map(n=>new Option(n,n)));
    this.instrument.options[0].disabled=true;
    this.layer.replaceChildren(new Option('None',''),...names.map(n=>new Option(n,n)));
    this.instrument.value=this.directFolder?names[0]:names.includes(selected[0])?selected[0]:'';
    this.layer.value=names.includes(selected[1])&&selected[1]!==selected[0]?selected[1]:'';
    this.feedback.textContent=this.folder&&this.needsAccess?'Allow folder access to check the saved folder.':
      names.length?'':'Choose an instrument folder containing WAVs or a library with one subfolder per instrument.';
    this.update();
  }
  async restoreLibrary(){
    try{
      const [saved,registered]=await Promise.all([librarySetting(undefined,'mellotron'),librarySetting(undefined,'tapeLibrary')]);
      this.library=registered;
      if(!registered&&saved?.folder){
        this.library={folder:saved.folder,names:saved.names,id:crypto.randomUUID()};
        await librarySetting(this.library,'tapeLibrary');
      }
      if(validTapeSettings(saved?.settings))this.settings=saved.settings;
      const rehearsalSelected=!saved?.folder&&this.library?.id&&saved?.libraryId===this.library.id;
      if(this.library&&!rehearsalSelected){
        const {folder}=this.library;
        const same=saved?.folder&&await folder.isSameEntry(saved.folder);
        this.folder=folder;
        this.needsAccess=await folder.queryPermission({mode:'read'})!=='granted';
        this.populate(this.library.names,same?saved.banks:[]);
        if(!this.needsAccess){
          Object.assign(this.library,await scanTapeFolder(folder));
          this.populate(this.library.names,same?saved.banks:[]);
        }
      }else if(saved)this.populate(rehearsalBanks,saved.banks);
    }catch(e){this.feedback.textContent=e.message;}
    this.update();
  }
  async ready(){
    await this.initialized;
    this.loaded=null;this.live=false;this.audioReady=true;this.update();
  }
  get directFolder(){return !!(this.folder&&this.library?.direct);}
  async reopenFolder(){
    const {folder}=this.library;
    if(await folder.requestPermission({mode:'read'})!=='granted')throw Error('Allow access to the tape folder to read its instruments.');
    await this.configureLibrary(folder);
  }
  async configureLibrary(folder){
    const {names,direct}=await scanTapeFolder(folder);
    const selected=this.folder&&await folder.isSameEntry(this.folder)?this.selectedBanks():[];
    const library={folder,names,direct,id:crypto.randomUUID()};
    this.needsAccess=false;
    this.library=library;this.folder=folder;this.populate(names,selected);
    try{await librarySetting(library,'tapeLibrary');}
    catch{throw Error('Tapes available for this session. The browser could not remember the folder.');}
  }
  async choose(){
    const folder=await showDirectoryPicker({mode:'read',id:'waswan-tapes'});
    await this.configureLibrary(folder);
    if(this.directFolder&&this.audioReady)await this.load(this.selectedBanks(),this.revision);
  }
  selectedBanks(){return [this.instrument.value,this.layer.value||this.instrument.value];}
  sameSelection(){
    return this.loaded&&this.folder===this.loaded.folder&&this.selectedBanks().every((name,i)=>name===this.loaded.banks[i]);
  }
  async applySelection(){
    if(this.layer.value===this.instrument.value)this.layer.value='';
    ++this.revision;
    if(this.selecting)return;
    this.selecting=true;
    try{
      await this.run(async()=>{
        let revision;
        do{
          revision=this.revision;
          const banks=this.selectedBanks();
          this.feedback.textContent='Loading '+[...new Set(banks)].join(' + ')+'…';
          try{await this.load(banks,revision);}
          catch(error){if(revision===this.revision)throw error;}
        }while(revision!==this.revision);
        this.feedback.textContent='';
      });
    }finally{this.selecting=false;this.update();}
  }
  async load(banks,revision){
    if(!banks[0])throw Error('Choose an instrument first.');
    if(this.folder){
      this.needsAccess=await this.folder.requestPermission({mode:'read'})!=='granted';
      if(this.needsAccess)throw Error('Allow folder access, then retry the selection.');
    }
    const {regions,id}=await preparePair(this.folder,banks,this.directFolder);
    if(revision!==this.revision)return;
    const tape={banks,id,settings:{...this.settings}};
    const token=await this.request('daw-tape-begin',{regions:regions.map(({bank,root,pcm})=>({bank,root,frames:pcm.length}))});
    let offset=0;
    for(const {pcm} of regions)for(let i=0;i<pcm.length;i+=32768){
      if(revision!==this.revision)return;
      const chunk=pcm.slice(i,i+32768);
      await this.request('daw-tape-chunk',{token,offset,pcm:chunk},[chunk.buffer]);
      offset+=Math.min(32768,pcm.length-i);
    }
    if(revision!==this.revision)return;
    await this.request('daw-tape-commit',{token,tape});
    this.loaded={id,banks,folder:this.folder,libraryId:this.library?.id,names:this.names};
    this.live=true;this.update();await this.save();
  }
  get sound(){return this.loaded?[...new Set(this.loaded.banks)].join(' + '):'';}
  snapshot(){return this.loaded?{id:this.loaded.id,banks:[...this.loaded.banks],settings:{...this.settings}}:null;}
  save(){return librarySetting({...this.loaded,settings:this.settings},'mellotron');}
  update(){
    this.source.textContent=(this.directFolder?'Instrument folder · ':'Library · ')+(this.folder?(this.folder.name||'Tape folder'):'Rehearsal instruments');
    this.pickers.disabled=!this.audioReady||(this.busy&&!this.selecting);
    this.fields.disabled=!this.audioReady||!!this.busy;
    this.layer.disabled=!this.instrument.value||this.names.length<2;
    this.allow.hidden=!this.folder||!this.needsAccess;
    this.openLibrary.hidden=!this.directFolder||!globalThis.showDirectoryPicker;
    const mix=this.controls.get('mix');
    mix.parentNode.hidden=!this.layer.value;mix.disabled=!!this.busy;
    this.savedFolder.hidden=!this.library||this.folder===this.library.folder;
    this.reload.hidden=!this.folder||!this.instrument.value;
    this.play.hidden=!this.instrument.value||(this.sameSelection()&&this.live);
    this.switch.hidden=!this.live;
    this.status.textContent=this.live?this.sound+' · playing on Part A':this.audioReady?'Synth on Part A':'Start audio to play.';
    for(const [key,input] of this.controls){
      if(input.type==='checkbox')input.checked=!!this.settings[key];else input.value=this.settings[key];
    }
  }
  async run(fn,propagate=false){
    if(this.busy){
      if(propagate)throw Error('Finish the current tape operation first.');
      return;
    }
    this.busy=true;this.feedback.textContent='';this.update();
    try{await fn();}
    catch(e){
      if(propagate)throw e;
      if(e.name!=='AbortError')this.feedback.textContent=e.message;
    }
    finally{this.busy=false;this.update();}
  }
}
