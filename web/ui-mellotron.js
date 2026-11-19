// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {librarySetting} from './tone-bank.js';
import {preparePair,rehearsalBanks} from './mellotron-library.js';
import {tapeDefaults,tapeControls,validTapeSettings} from './mellotron-settings.js';

export class MellotronPanel {
  constructor(request){
    this.request=request;this.settings=tapeDefaults();
    this.node=el('details','ww-panel ww-tapes');
    this.node.append(el('summary','','Mellotron · Part A'));
    this.fields=el('fieldset');this.fields.disabled=true;this.node.append(this.fields);
    this.fields.append(el('p','','Load two banks to play on Analog Part A. For your own tapes, choose a folder with one subfolder per bank and name each WAV by MIDI root (e.g. 60 Flute.wav).'));
    this.status=el('p','','Start audio to load tapes.');this.status.setAttribute('role','status');
    this.selects=['Bank A','Bank B'].map(name=>{
      const select=el('select');this.field(name,select);return select;
    });
    this.populate(rehearsalBanks,rehearsalBanks);
    this.fields.append(action('Open tape folder',()=>this.run(()=>this.choose())),
      action('Use rehearsal banks',()=>this.run(()=>{this.folder=null;this.populate(rehearsalBanks,rehearsalBanks);})),
      action('Load both banks',()=>this.run(()=>this.load())));
    this.switch=action('Use Synth on Part A',()=>this.run(async()=>{
      await this.request('daw-tape-live',{enabled:!this.live,settings:this.settings});
      this.live=!this.live;this.update();await this.save();
    }));
    this.fields.append(this.switch);
    this.controls=new Map();
    const group=el('div','ww-tape-controls');this.fields.append(group);
    for(const [key,label,min,max,value] of tapeControls){
      const input=el('input');input.type=max===1?'checkbox':'number';input.min=min;input.max=max;input.value=value;
      this.field(label,input,group);this.controls.set(key,input);
      input.onchange=()=>this.run(async()=>{
        const settings={...this.settings,[key]:max===1?Number(input.checked):input.valueAsNumber};
        if(!validTapeSettings(settings))throw Error('Choose a value between '+min+' and '+max+'.');
        if(this.loaded)await this.request('daw-tape-live',{enabled:this.live,settings});
        this.settings=settings;if(this.loaded)await this.save();
      });
    }
    this.node.append(this.status);this.update();
  }
  field(name,input,parent=this.fields){const label=el('label','',name);input.setAttribute('aria-label',name);label.append(input);parent.append(label);}
  populate(names,selected){
    this.selects.forEach((s,i)=>{s.replaceChildren(...names.map(n=>new Option(n,n)));s.value=names.includes(selected?.[i])?selected[i]:names[Math.min(i,names.length-1)];});
  }
  async ready(){
    this.loaded=null;this.live=false;this.fields.disabled=true;
    try{
      const saved=await librarySetting(undefined,'mellotron');
      if(saved){
        this.folder=saved.folder;this.populate(saved.names,saved.banks);
        if(validTapeSettings(saved.settings))this.settings=saved.settings;
        this.status.textContent='Load both banks to reopen your last selection.';
      }else this.status.textContent='Rehearsal banks are ready to load.';
    }catch(e){this.status.textContent=e.message;}
    this.fields.disabled=false;this.update();
  }
  async choose(){
    const folder=await showDirectoryPicker({mode:'read',id:'waswan-tapes'});
    const names=[];for await(const handle of folder.values())if(handle.kind==='directory')names.push(handle.name);
    if(!names.length)throw Error('Choose a folder containing bank subfolders.');
    this.folder=folder;this.populate(names.sort(),[]);this.status.textContent='Select banks A and B, then load.';
  }
  async load(){
    if(this.folder && await this.folder.requestPermission({mode:'read'})!=='granted')throw Error('Allow folder access or choose the folder again.');
    const banks=this.selects.map(s=>s.value),{regions,id}=await preparePair(this.folder,banks);
    const tape={banks,id,settings:{...this.settings}};
    const token=await this.request('daw-tape-begin',{regions:regions.map(({bank,root,pcm})=>({bank,root,frames:pcm.length}))});
    let offset=0;
    for(const {pcm} of regions)for(let i=0;i<pcm.length;i+=32768){
      const chunk=pcm.slice(i,i+32768);
      await this.request('daw-tape-chunk',{token,offset,pcm:chunk},[chunk.buffer]);
      offset+=Math.min(32768,pcm.length-i);
    }
    await this.request('daw-tape-commit',{token,tape});
    this.loaded={id,banks,folder:this.folder,names:[...this.selects[0].options].map(o=>o.value)};
    this.live=true;this.update();await this.save();
  }
  snapshot(){return this.loaded?{id:this.loaded.id,banks:[...this.loaded.banks],settings:{...this.settings}}:null;}
  save(){return librarySetting({...this.loaded,settings:this.settings},'mellotron');}
  update(){
    this.switch.disabled=!this.loaded;
    this.switch.textContent=this.live?'Use Synth on Part A':'Play Mellotron on Part A';
    if(this.loaded)this.status.textContent=this.loaded.banks.join(' + ')+' · '+(this.live?'playing on Part A':'available in DAW presets');
    for(const [key,input] of this.controls){
      if(input.type==='checkbox')input.checked=!!this.settings[key];else input.value=this.settings[key];
    }
  }
  async run(fn){
    if(this.fields.disabled)return;
    this.fields.disabled=true;
    try{await fn();}catch(e){this.update();if(e.name!=='AbortError')this.status.textContent=e.message;}
    finally{this.fields.disabled=false;}
  }
}
