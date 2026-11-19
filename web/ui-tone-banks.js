// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {TONE_FILE_EXTENSION,readToneFile,readToneFolder,saveToneFile} from './tone-bank.js';

export class ToneBanks {
  constructor(send){
    this.send=send;
    this.request=0;
    this.tones=[];
    this.button=action('Tone banks',()=>{
      this.name.value='';
      this.dialog.showModal();
    });
    this.dialog=el('dialog','ww-map-dialog ww-tone-banks');
    const title=el('h2','','Tone banks');
    title.id='ww-tone-banks-title';
    this.dialog.setAttribute('aria-labelledby',title.id);
    this.folder=el('p','',globalThis.showDirectoryPicker?
      'Choose a folder containing WASWAN tone files.':'Folder access is unavailable in this browser. You can still open individual WASWAN tone files.');
    this.choose=action('Choose bank folder…',()=>this.run(()=>this.chooseFolder()));
    this.refresh=action('Refresh folder',()=>this.run(()=>this.scan()));
    this.openFile=action('Open tone file…',()=>this.file.click());
    this.file=el('input');
    this.file.type='file';
    this.file.accept=TONE_FILE_EXTENSION;
    this.file.hidden=true;
    this.file.onchange=()=>{
      const [file]=this.file.files;
      this.file.value='';
      if(file)this.run(async()=>{
        const tone=await readToneFile(file);
        this.openedTone={fileName:file.name,...tone};
        this.renderTones(this.openedTone);
        this.status.textContent='Tone file opened. Choose Load tone to play it.';
      });
    };
    this.select=el('select');
    const toneLabel=el('label','','Bank tone');
    toneLabel.append(this.select);
    this.load=action('Load tone',()=>this.run(()=>this.loadTone()));
    const nameLabel=el('label','','Name for new file');
    this.name=el('input');
    this.name.maxLength=80;
    nameLabel.append(this.name);
    this.save=action('Save current tone to folder',()=>this.run(()=>this.saveTone()));
    this.status=el('p','ww-muted');
    this.status.setAttribute('role','status');
    const close=action('Close',()=>this.dialog.close());
    close.autofocus=true;
    this.dialog.append(title,this.folder,this.choose,this.refresh,this.openFile,this.file,toneLabel,this.load,
      nameLabel,this.save,this.status,close);
    document.body.append(this.dialog);
    this.renderTones();
    this.updateButtons();
  }
  async run(task){
    if(this.busy)return;
    this.busy=true;
    this.updateButtons();
    this.status.textContent='';
    try{await task();}
    catch(error){if(error.name!=='AbortError')this.status.textContent=error.message;}
    finally{this.busy=false;this.updateButtons();}
  }
  updateButtons(){
    const ready=this.running&&this.frame?.toneBanks&&this.frame?.instrument.programAvailable;
    this.choose.disabled=this.busy||!globalThis.showDirectoryPicker;
    this.openFile.disabled=!!this.busy;
    this.refresh.disabled=this.busy||!this.directory;
    this.select.disabled=this.busy||!this.select.value;
    this.load.disabled=this.busy||!ready||!this.select.value;
    this.save.disabled=this.busy||!ready||!this.directory;
  }
  renderTones(preferred){
    this.items=this.openedTone?[this.openedTone,...this.tones]:this.tones;
    this.select.replaceChildren();
    this.items.forEach((tone,index)=>{
      const option=new Option(tone===this.openedTone?`${tone.name} · opened file`:tone.name,String(index));
      option.title=tone.fileName;
      this.select.add(option);
    });
    if(!this.items.length)this.select.add(new Option('No tones available',''));
    else if(preferred)this.select.value=String(this.items.indexOf(preferred));
  }
  async chooseFolder(){
    const directory=await globalThis.showDirectoryPicker({id:'waswan-tone-banks',mode:'read'});
    await this.scan(directory);
  }
  async scan(directory=this.directory,selectedFile){
    const {tones,skipped}=await readToneFolder(directory);
    this.directory=directory;
    this.tones=tones;
    this.openedTone=null;
    this.renderTones(tones.find(tone=>tone.fileName===selectedFile));
    this.folder.textContent=`Folder “${directory.name}” · ${tones.length} ${tones.length===1?'tone':'tones'}`;
    this.status.textContent=skipped?`Skipped ${skipped} unreadable or invalid tone ${skipped===1?'file':'files'}.`:'';
  }
  async saveTone(){
    const {instrument}=this.frame;
    const name=this.name.value.trim()||instrument.name||'Untitled tone';
    const directory=this.directory;
    if(directory.requestPermission&&await directory.requestPermission({mode:'readwrite'})!=='granted')
      throw Error('Write access to the bank folder was denied.');
    const {patch}=await this.command('tone-bank-read',instrument);
    const fileName=await saveToneFile(directory,name,patch);
    this.name.value='';
    try{
      await this.scan(directory,fileName);
      this.status.textContent=`Saved “${name}” to disk. ${this.status.textContent}`.trim();
    }catch(error){
      this.status.textContent=`Saved “${name}” to disk. Refresh failed: ${error.message}`;
    }
  }
  async loadTone(){
    const tone=this.items[Number(this.select.value)];
    const {instrument,track}=this.frame;
    const part='ABCD'[track];
    if(instrument.edited&&!globalThis.confirm(`Discard the current edits in Part ${part} and load “${tone.name}”?`))return;
    await this.command('tone-bank-load',instrument,{patch:tone.patch,discard:instrument.edited});
    this.status.textContent=`Loaded “${tone.name}” into Part ${part}.`;
  }
  command(t,{scope,programToken:token},fields={}){
    return new Promise((resolve,reject)=>{
      const request=++this.request;
      const timeout=setTimeout(()=>{
        this.pending=null;
        reject(Error('The instrument did not respond. Try again.'));
      },5000);
      this.pending=result=>{
        clearTimeout(timeout);
        this.pending=null;
        if(result.error)reject(Error(result.error));else resolve(result);
      };
      this.send({t,scope,token,request,...fields});
    });
  }
  update(frame,running){
    this.frame=frame;
    this.running=running;
    if(this.pending&&frame.toneBankResult?.request===this.request)this.pending(frame.toneBankResult);
    this.name.placeholder=frame.instrument?.name||'Current tone name';
    this.updateButtons();
  }
}
