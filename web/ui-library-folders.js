// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {librarySetting} from './tone-bank.js';

export class LibraryFolders {
  constructor(banks,tapes){
    this.node=el('details','ww-instrument-group ww-library-folders');
    this.node.append(el('summary','','Library folders'),
      el('p','ww-muted','This browser remembers your folders. Sounds stay on disk.'));
    this.rows=[];
    this.add('Tone banks','waswan-tone-banks',async()=>{
      await banks.initialized;
      return banks.library?.root;
    },folder=>banks.run(()=>banks.configureLibrary(folder,banks.bankKey,undefined,true),true));
    this.add('Mellotron tapes','waswan-tapes',async()=>{
      await tapes.initialized;
      return tapes.library?.folder;
    },folder=>tapes.run(()=>tapes.configureLibrary(folder),true));
    this.add('Samples (sampler planned)','waswan-samples',
      ()=>librarySetting(undefined,'sampleLibrary'),folder=>librarySetting(folder,'sampleLibrary'));
    this.node.ontoggle=()=>{if(this.node.open)this.refresh();};
  }
  add(label,id,read,apply){
    const group=el('fieldset'),status=el('span','ww-muted');
    status.setAttribute('role','status');
    const choose=action('Choose folder…',()=>change(true));
    const renew=action('Refresh folder',()=>change(false));
    group.append(el('legend','',label),status,choose,renew);
    this.node.append(group);
    let handle,busy=false,revision=0;
    function buttons(){
      choose.disabled=busy||!globalThis.showDirectoryPicker;
      renew.hidden=!handle||!globalThis.showDirectoryPicker;
      renew.disabled=busy;
    }
    async function refresh(){
      if(busy)return;
      const version=++revision;
      try{
        const folder=await read();
        const permission=await folder?.queryPermission({mode:'read'});
        if(version!==revision)return;
        handle=folder;
        status.textContent=folder?folder.name+(permission==='granted'?'':' · access required'):
          globalThis.showDirectoryPicker?'No folder chosen':'Folder access unavailable in this browser';
        renew.textContent=permission==='granted'?'Refresh folder':'Allow access';
      }catch(error){if(version===revision)status.textContent=error.message;}
      buttons();
    }
    async function change(pick){
      if(busy)return;
      busy=true;++revision;buttons();
      try{
        const folder=pick?await showDirectoryPicker({id,mode:'read',...(handle?{startIn:handle}:{})}):handle;
        if(!pick&&await folder.requestPermission({mode:'read'})!=='granted')
          throw Error('Access denied. Use Allow access to retry.');
        // Wait for old saved settings before applying a replacement.
        await read();
        await apply(folder);
        busy=false;await refresh();
      }catch(error){
        busy=false;
        if(error.name==='AbortError')await refresh();
        else{
          status.textContent=(handle?handle.name+' · ':'')+(error.name==='NotFoundError'?'Folder missing. Choose its new location.':error.message);
          renew.textContent='Allow access';
        }
      }finally{buttons();}
    }
    buttons();
    this.rows.push(refresh);
  }
  refresh(){for(const row of this.rows)void row();}
}
