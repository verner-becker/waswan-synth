// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {TONE_FILE_EXTENSION,readToneFile,readToneFolder,saveToneFile,libraryBanks,librarySetting} from './tone-bank.js';
import {decodeDx7,writeDx7Bank} from './fm-dx7.js';

export class ToneBanks {
  constructor(send,internal){
    this.send=send;
    this.request=0;
    this.tones=[];
    this.loaded=new Map();
    this.fileDate=new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'});
    this.internal=internal;
    this.bankKey='internal';
    this.bank=el('select','ww-bank-select');
    this.bank.setAttribute('aria-label','Tone bank');
    this.quickTone=el('select','ww-bank-select');
    this.quickTone.setAttribute('aria-label','Folder tone');
    this.quickTone.onchange=()=>{
      const tone=this.tones[this.quickTone.selectedIndex-1];
      if(!tone)return;
      if(this.pickingTone){this.pickingTone.tone=tone;return;}
      if(this.busy)return;
      const pick=this.pickingTone={tone,scope:this.frame.instrument.scope};
      this.run(async()=>{
        try{
          let requested;
          do{
            requested=pick.tone;
            await this.loadTone(requested);
          }while(requested!==pick.tone&&pick.scope===this.frame.instrument.scope);
        }
        finally{this.pickingTone=null;}
      });
    };
    this.bank.onchange=()=>{
      const key=this.bank.value;
      this.bank.value=this.bankKey;
      if(key==='manage'){this.open('browse');return;}
      this.run(()=>this.changeBank(key));
    };
    this.picker=el('div','ww-program-picker');
    const bankLabel=el('label','','Bank'),toneField=el('div','ww-tone-field');
    bankLabel.append(this.bank);
    toneField.append(el('span','','Tone'),internal,this.quickTone);
    this.picker.append(bankLabel,toneField);
    this.feedback=el('small','ww-muted');
    this.feedback.setAttribute('role','status');
    this.dialog=el('dialog','ww-map-dialog ww-tone-banks');
    const title=el('h2','','Tone banks');
    title.id='ww-tone-banks-title';
    this.dialog.setAttribute('aria-labelledby',title.id);
    const head=el('div','ww-bank-heading');
    head.append(title,action('Close',()=>this.dialog.close()));
    this.context=el('p','ww-bank-context');
    this.folder=el('strong','',globalThis.showDirectoryPicker?'No bank folder open':'Folder access unavailable in this browser');
    this.libraryLabel=el('strong');
    this.choose=action('Choose library folder…',()=>this.run(()=>this.chooseFolder()));
    this.refresh=action('Refresh folder',()=>this.run(()=>this.scan()));
    const location=el('div','ww-bank-location');
    this.destination=el('select');
    this.destination.setAttribute('aria-label','Library bank');
    this.destination.onchange=()=>{
      const key=this.destination.value;
      if(key==='new'){this.updateButtons();this.newFolder.focus();return;}
      this.run(async()=>{
        try{await this.changeBank(key);}
        catch(error){
          this.destination.value=this.importPanel.hidden?this.bankKey:'internal';
          throw error;
        }
      });
    };
    location.append(this.folder,this.libraryLabel,this.destination,this.choose,this.refresh);
    this.browseButton=action('Browse tones',()=>this.setMode('browse'));
    this.createButton=action('Create bank tone',()=>this.setMode('create'));
    this.importButton=action('Import DX7',()=>this.setMode('import'));
    this.importButton.hidden=!globalThis.showDirectoryPicker;
    const modes=el('div','ww-bank-modes');
    modes.setAttribute('role','group');
    modes.setAttribute('aria-label','Bank action');
    modes.append(this.browseButton,this.createButton,this.importButton);
    this.browse=el('section');
    this.create=el('section');
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
        this.search.value='';
        this.renderTones(this.openedTone);
        this.status.textContent='Tone file opened. Load it into the selected part to play it.';
      });
    };
    const searchLabel=el('label','','Find a tone');
    this.search=el('input');
    this.search.type='search';
    this.search.oninput=()=>{this.renderTones();this.updateButtons();};
    searchLabel.append(this.search);
    this.select=el('select');
    this.select.size=5;
    const toneLabel=el('label','','Bank tone');
    toneLabel.append(this.select);
    this.load=action('Load into part',()=>this.run(()=>this.loadTone()),'ww-primary');
    this.browse.append(searchLabel,toneLabel,this.load,this.openFile,this.file);
    const nameLabel=el('label','','New tone name');
    this.name=el('input');
    this.name.maxLength=80;
    this.name.required=true;
    this.name.oninput=()=>this.updateButtons();
    nameLabel.append(this.name);
    this.save=action('Create tone file',()=>this.run(()=>this.saveTone()),'ww-primary');
    this.create.append(nameLabel,el('p','ww-muted','Capture the current sound as a new .wstone file in this folder. Existing files and instrument programs are preserved.'),this.save);
    this.importPanel=el('section');
    const dx7Label=el('label','','DX7 SysEx file');
    this.dx7File=el('input');
    this.dx7File.type='file';
    this.dx7File.accept='.syx';
    this.dx7File.onchange=()=>this.run(()=>this.previewDx7());
    dx7Label.append(this.dx7File);
    this.newFolderLabel=el('label','','New bank folder name');
    this.newFolder=el('input');
    this.newFolder.maxLength=80;
    this.newFolder.oninput=()=>this.updateButtons();
    this.newFolderLabel.append(this.newFolder);
    this.preview=el('p','ww-muted');
    this.importSave=action('Import tones',()=>this.run(()=>this.importDx7()),'ww-primary');
    this.importPanel.append(dx7Label,this.newFolderLabel,this.preview,this.importSave);
    this.status=el('p','ww-muted');
    this.status.setAttribute('role','status');
    this.dialog.append(head,this.context,location,modes,this.browse,this.create,this.importPanel,this.status);
    document.body.append(this.dialog);
    this.renderTones();
    this.setMode('browse');
    if(globalThis.showDirectoryPicker)this.restoreLibrary();
  }
  async restoreLibrary(){
    this.restoring=true;
    this.updateButtons();
    try{
      this.library=await librarySetting();
      this.renderBanks();
    }catch{this.feedback.textContent='Chrome could not read the saved library folder.';}
    finally{this.restoring=false;this.updateButtons();}
  }
  renderBanks(){
    this.bank.replaceChildren(new Option('Internal','internal'));
    const prompt=new Option('Select a folder bank…','internal');
    prompt.disabled=true;
    this.destination.replaceChildren(prompt);
    for(const bank of this.library?.banks||[]){
      this.bank.add(new Option(bank.name,bank.key));
      this.destination.add(new Option(bank.name,bank.key));
    }
    if(this.library&&!this.importPanel.hidden)this.destination.add(new Option('New bank folder…','new'));
    this.destination.hidden=!this.library;
    this.destination.value=this.bankKey==='internal'&&this.library&&!this.importPanel.hidden?'new':this.bankKey;
    this.libraryLabel.textContent=this.library?`Library “${this.library.root.name}”`:'Choose a library folder for the imported tones.';
    if(globalThis.showDirectoryPicker)this.bank.add(new Option('Choose library folder…','choose'));
    if(this.library)this.bank.add(new Option('Refresh banks','refresh'));
    this.bank.add(new Option('Manage tones…','manage'));
    this.bank.value=this.bankKey;
  }
  async changeBank(key){
    if(key==='choose'){await this.chooseFolder();return;}
    if(key==='internal'){
      this.bankKey=key;
      this.directory=null;
      this.tones=[];
      this.openedTone=null;
      this.search.value='';
      this.renderTones();
      this.folder.textContent=this.library?'Library “'+this.library.root.name+'” · Select a folder bank.':'No bank folder open';
    }else{
      const {root}=this.library;
      if(root.requestPermission&&await root.requestPermission({mode:'read'})!=='granted')
        throw Error('Folder access denied. Select the bank to retry or choose its library folder again.');
      if(key==='refresh'){await this.configureLibrary(root,this.bankKey);return;}
      const bank=this.library.banks.find(item=>item.key===key);
      const directory=key==='root'?root:await root.getDirectoryHandle(bank.name);
      await this.scan(directory);
      this.bankKey=key;
    }
    this.renderBanks();
  }
  async configureLibrary(root,preferred,selectedFile){
    const banks=await libraryBanks(root);
    const bank=banks.find(item=>item.key===preferred)||banks[0];
    if(preferred!=='internal'){
      const directory=bank.key==='root'?root:await root.getDirectoryHandle(bank.name);
      await this.scan(directory,selectedFile);
      this.bankKey=bank.key;
    }
    this.library={root,banks};
    this.renderBanks();
    try{await librarySetting(this.library);}
    catch{this.report('Library available for this session. Chrome could not remember the folder.');}
  }
  report(message){
    (this.dialog.open?this.status:this.feedback).textContent=message;
  }
  open(mode){
    this.setMode(mode);
    this.dialog.showModal();
    if(mode==='import')this.dx7File.focus();
    else if(!this.directory){
      (this.library?this.destination:globalThis.showDirectoryPicker?this.choose:this.openFile).focus();
    }else if(mode==='create')this.name.focus();
    else (this.search.disabled?this.createButton:this.search).focus();
  }
  setMode(mode){
    this.status.textContent='';
    const create=mode==='create';
    if(create&&!this.name.value)this.name.value=this.name.placeholder;
    const importing=mode==='import';
    this.browse.hidden=mode!=='browse';
    this.create.hidden=!create;
    this.importPanel.hidden=!importing;
    this.folder.hidden=this.context.hidden=importing;
    this.libraryLabel.hidden=!importing;
    this.browseButton.setAttribute('aria-pressed',String(mode==='browse'));
    this.createButton.setAttribute('aria-pressed',String(create));
    this.importButton.setAttribute('aria-pressed',String(importing));
    this.renderBanks();
    this.updateButtons();
  }
  sourceLabel(frame){
    const loaded=this.loaded.get(frame.track);
    if(!loaded)return '';
    return (this.hasUnsavedEdits(frame)?'Last file loaded · ':'Bank tone · ')+loaded.name;
  }
  hasUnsavedEdits(frame){
    const {instrument,track}=frame,loaded=this.loaded.get(track);
    // Loading a disk tone sets the internal slot's edit flag. Its load receipt
    // fingerprints the applied patch, including FM and the part's shared effects.
    return instrument.edited&&(loaded?.scope!==instrument.scope||loaded?.token!==instrument.programToken);
  }
  async run(task){
    if(this.busy)return;
    this.busy=true;
    this.updateButtons();
    this.status.textContent='';
    this.feedback.textContent='';
    let focusTarget;
    try{focusTarget=await task();}
    catch(error){if(error.name!=='AbortError')this.report(error.name==='NotFoundError'?'Bank folder missing. Refresh banks or choose the library folder again.':error.message);}
    finally{this.busy=false;this.updateButtons();}
    if(this.dialog.open)focusTarget?.focus();
  }
  updateButtons(){
    const ready=this.running&&this.frame?.toneBanks&&this.frame?.instrument.programAvailable;
    this.destination.disabled=this.bank.disabled=!!(this.restoring||this.busy);
    this.internal.hidden=this.bankKey!=='internal';
    this.quickTone.hidden=!this.internal.hidden;
    this.quickTone.disabled=(this.busy&&!this.pickingTone)||!ready||!this.tones.length;
    const loaded=this.loaded.get(this.frame?.track);
    const inBank=loaded&&loaded.root===this.library?.root&&loaded.bank===this.bankKey;
    const editedFile=inBank&&loaded.fileName&&this.hasUnsavedEdits(this.frame);
    const hint=editedFile?`${loaded.name} · Edited`:this.tones.length?'Choose a tone…':'Empty bank';
    const placeholder=this.quickTone.options[0];
    if(placeholder&&placeholder.text!==hint)placeholder.text=hint;
    const pending=this.pickingTone;
    const current=pending&&pending.scope===this.frame.instrument.scope?pending.tone.fileName:
      inBank&&!editedFile?loaded.fileName:'';
    if(this.quickTone.value!==current)this.quickTone.value=current||'';
    if(this.quickTone.selectedIndex<0)this.quickTone.selectedIndex=0;
    this.choose.disabled=this.restoring||this.busy||!globalThis.showDirectoryPicker;
    this.openFile.disabled=!!this.busy;
    this.importButton.disabled=this.dx7File.disabled=this.newFolder.disabled=!!this.busy;
    const newBank=this.destination.value==='new';
    this.newFolderLabel.hidden=!newBank;
    const hasDestination=newBank?this.library&&this.newFolder.value.trim():
      this.directory&&this.destination.value===this.bankKey;
    this.importSave.disabled=this.busy||!this.dx7Tones||!hasDestination;
    this.refresh.disabled=this.busy||!this.directory;
    this.search.disabled=this.busy||(!this.tones.length&&!this.openedTone);
    this.select.disabled=this.busy||!this.select.value;
    this.load.disabled=this.busy||!ready||!this.select.value;
    this.createButton.disabled=this.busy||!globalThis.showDirectoryPicker;
    this.browseButton.disabled=this.name.disabled=!!this.busy;
    this.save.disabled=this.busy||!ready||!this.directory||!this.name.value.trim();
    this.refresh.hidden=!this.directory||!this.importPanel.hidden;
    this.choose.hidden=!globalThis.showDirectoryPicker;
    const part=this.frame?'Part '+'ABCD'[this.frame.track]:'part';
    const label='Load into '+part;
    if(this.load.textContent!==label)this.load.textContent=label;
    const context=!this.running?'Start audio to load or capture a tone.':
      part+' · Program '+this.frame.programs[this.frame.track]+' · '+(this.sourceLabel(this.frame)||this.frame.instrument.name)+
      (this.hasUnsavedEdits(this.frame)?' · Edited':'')+(ready?'':' · Instrument unavailable');
    if(this.context.textContent!==context)this.context.textContent=context;
  }
  renderTones(preferred=this.items?.[Number(this.select.value)]){
    const all=this.openedTone?[this.openedTone,...this.tones]:this.tones;
    const query=this.search.value.trim().toLocaleLowerCase();
    const counts=new Map(),positions=new Map();
    for(const tone of this.tones){
      const position=(counts.get(tone.name)||0)+1;
      counts.set(tone.name,position);
      positions.set(tone,position);
    }
    this.labels=new Map();
    for(const tone of this.tones){
      if(counts.get(tone.name)>1)this.labels.set(tone,`${tone.name} · #${positions.get(tone)} · ${this.fileDate.format(tone.modified)}`);
    }
    this.items=all.filter(tone=>tone.name.toLocaleLowerCase().includes(query)||tone.fileName.toLocaleLowerCase().includes(query));
    this.select.replaceChildren();
    this.items.forEach((tone,index)=>{
      const option=new Option(tone===this.openedTone?`${tone.name} · opened file`:this.optionLabel(tone),String(index));
      option.title=tone.fileName;
      this.select.add(option);
    });
    if(!this.items.length)this.select.add(new Option(query?'No matching tones':this.directory?'This bank is empty':'Choose a folder or open a tone file',''));
    this.select.selectedIndex=Math.max(0,this.items.indexOf(preferred));
  }
  optionLabel(tone){return this.labels.get(tone)||tone.name;}
  async chooseFolder(){
    const directory=await globalThis.showDirectoryPicker({id:'waswan-tone-banks',mode:'read'});
    await this.configureLibrary(directory);
    if(!this.importPanel.hidden)return this.dx7File;
    if(!this.create.hidden)return this.name;
    return this.items.length?this.select:this.createButton;
  }
  async previewDx7(){
    this.dx7Tones=null;
    this.preview.textContent='';
    const [file]=this.dx7File.files;
    if(!file)return;
    if(file.size>4104)throw Error('Expected a single DX7 voice or a 32-voice cartridge.');
    this.dx7Tones=decodeDx7(new Uint8Array(await file.arrayBuffer()));
    const count=this.dx7Tones.length;
    this.preview.textContent=`${count} ${count===1?'tone':'tones'} ready to import as .wstone.`;
    const suggestion=file.name.replace(/\.syx$/i,'').replace(/[\\/:*?"<>|]/g,'-').slice(0,80);
    if(!this.newFolder.value||this.newFolder.value===this.newFolder.placeholder)this.newFolder.value=suggestion;
    this.newFolder.placeholder=suggestion;
  }
  async importDx7(){
    const root=this.library.root,tones=this.dx7Tones;
    const newBank=this.destination.value==='new';
    const name=newBank?this.newFolder.value.trim():'';
    if(newBank&&(!name||name==='.'||name==='..'||/[\\/:*?"<>|\u0000-\u001f]/.test(name)))
      throw Error('Enter a valid folder name.');
    const {target,first}=await writeDx7Bank(newBank?root:this.directory,tones,name);
    this.dx7Tones=null;
    this.dx7File.value=this.newFolder.value=this.preview.textContent='';
    const summary=`Imported ${tones.length} ${tones.length===1?'tone':'tones'} into “${target.name}”.`;
    try{
      this.search.value='';
      if(newBank){
        await this.configureLibrary(root,'folder:'+name,first);
      }else{
        await this.scan(target,first);
      }
      this.setMode('browse');
      this.report(summary);
      return this.select;
    }catch(error){this.report(summary+' Refresh banks to browse them. '+error.message);}
  }
  async scan(directory=this.directory,selectedFile){
    const previous=this.items[Number(this.select.value)];
    const keep=directory===this.directory;
    const keepOpened=!selectedFile&&keep&&previous===this.openedTone;
    if(!selectedFile&&keep&&!keepOpened)selectedFile=previous?.fileName;
    const {tones,skipped}=await readToneFolder(directory);
    this.directory=directory;
    this.tones=tones;
    if(!keep){
      this.openedTone=null;
      this.search.value='';
    }
    this.renderTones(keepOpened?this.openedTone:tones.find(tone=>tone.fileName===selectedFile));
    this.quickTone.replaceChildren(new Option(tones.length?'Choose a tone…':'Empty bank',''));
    this.quickTone.options[0].disabled=true;
    for(const tone of tones){
      const option=new Option(this.optionLabel(tone),tone.fileName);
      option.title=tone.fileName;
      this.quickTone.add(option);
    }
    this.folder.textContent=`Folder “${directory.name}” · ${tones.length} ${tones.length===1?'tone':'tones'}`;
    this.report(skipped?`Skipped ${skipped} unreadable or invalid tone ${skipped===1?'file':'files'}.`:'');
  }
  async saveTone(){
    const {instrument}=this.frame;
    const name=this.name.value.trim();
    const directory=this.directory;
    if(directory.requestPermission&&await directory.requestPermission({mode:'readwrite'})!=='granted')
      throw Error('Write access to the bank folder was denied.');
    const {patch}=await this.command('tone-bank-read',instrument);
    const fileName=await saveToneFile(directory,name,patch);
    this.name.value='';
    this.search.value='';
    this.setMode('browse');
    try{
      await this.scan(directory,fileName);
      this.status.textContent=`Saved “${name}” to disk. ${this.status.textContent}`.trim();
      return this.select;
    }catch(error){
      this.status.textContent=`Saved “${name}” to disk. Refresh failed: ${error.message}`;
    }
  }
  async loadTone(tone=this.items[Number(this.select.value)]){
    const {instrument,track}=this.frame;
    const part='ABCD'[track];
    if(this.hasUnsavedEdits(this.frame)&&!globalThis.confirm(`Discard the current edits in Part ${part} and load “${tone.name}”?`))return;
    const {token}=await this.command('tone-bank-load',instrument,{patch:tone.patch,discard:instrument.edited});
    this.loaded.set(track,{name:tone.name,scope:instrument.scope,token,root:this.library?.root,bank:this.bankKey,
      fileName:tone===this.openedTone?'':tone.fileName});
    this.dialog.close();
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
    const scopeChanged=this.frame?.instrument.scope!==frame.instrument.scope;
    this.frame=frame;
    this.running=running;
    if(this.pending&&frame.toneBankResult?.request===this.request)this.pending(frame.toneBankResult);
    const loaded=this.loaded.get(frame.track);
    if(loaded&&(!frame.instrument.edited||loaded.scope!==frame.instrument.scope))this.loaded.delete(frame.track);
    const suggestion=this.loaded.get(frame.track)?.name||frame.instrument.name;
    if(scopeChanged)this.name.value=this.create.hidden?'':suggestion;
    if(this.name.placeholder!==suggestion)this.name.placeholder=suggestion;
    this.updateButtons();
  }
}
