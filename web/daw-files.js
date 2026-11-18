// SPDX-License-Identifier: GPL-3.0-only
import {projectBlob,readProject,fileToken,archiveHeader,sourceChecksum} from './daw-format.js';
import {ImmutableAudioStore} from './daw-assets.js';
import {wavHeader} from './studio-format.js';
const type={description:'WASWAN project',accept:{'application/octet-stream':['.wsproj']}};
const safeId=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id);
const recoveryName=(meta,check)=>meta.id+'.'+check.crc32.toString(16)+'.'+meta.bytes+'.wav';
async function write(handle,blob){
  const writer=await handle.createWritable();
  try{await writer.write(blob);await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}
}
export class ProjectFiles {
  constructor({openPicker=options=>showOpenFilePicker(options),savePicker=options=>showSaveFilePicker(options),locks=globalThis.navigator?.locks,root=()=>navigator.storage.getDirectory(),createAssetStore=globalThis.navigator?.storage?.getDirectory?root=>ImmutableAudioStore.create(root):null}={}){
    Object.assign(this,{openPicker,savePicker,locks,root,createAssetStore});this.handle=null;this.token=null;this.busy=false;this.recoveryCache=new Map();
  }
  async exclusive(name,task){
    if(!this.locks?.request)throw Error('Web Locks is required for project writes');
    return this.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>{if(!lock)throw Error('Another project write is in progress');return task();});
  }
  async open({accept=()=>true,deferBinding=false}={}){
    if(this.busy)throw Error('Finish the current file operation');this.busy=true;
    let assetStore;
    try{
      const [handle]=await this.openPicker({types:[type],multiple:false}),file=await handle.getFile(),token=await fileToken(file);
      assetStore=this.createAssetStore?await this.createAssetStore(await this.root()):null;const loaded=await readProject(file,{assetStore});
      if(!await accept(loaded)){await assetStore?.dispose();return null;}
      if(await fileToken(await handle.getFile())!==token)throw Error('Project file changed while opening');
      loaded.binding={handle,token};if(!deferBinding)this.adoptBinding(loaded.binding);return loaded;
    }catch(error){await assetStore?.dispose().catch(()=>{});throw error;}finally{this.busy=false;}
  }
  async save(controller,{saveAs=false,savePicker=this.savePicker}={}){
    if(this.busy)throw Error('Finish the current file operation');this.busy=true;
    try{
      const document=controller.snapshot(),assets=new Map(controller.assets),revision=controller.revision;
      const handle=saveAs||!this.handle?await savePicker({types:[type],suggestedName:document.name.replace(/[\\/:*?"<>|]/g,'-')+'.wsproj'}):this.handle;
      const expected=handle===this.handle?this.token:await fileToken(await handle.getFile());
      if(handle.requestPermission&&await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('Project write permission was denied');
      const blob=await projectBlob(document,assets),nextToken=await fileToken(blob);
      await this.exclusive('waswan-project-file-writer-v1',async()=>{
        if(await fileToken(await handle.getFile())!==expected)throw Error('Project file changed outside this view. Use Save As to preserve both versions.');
        await write(handle,blob);
        if(await fileToken(await handle.getFile())!==nextToken)throw Error('Project file changed immediately after saving');
      });
      this.handle=handle;this.token=nextToken;controller.markSaved(document);
      return {name:handle.name,revision,dirty:controller.dirty};
    }finally{this.busy=false;}
  }
  forget(){this.handle=null;this.token=null;}
  adoptBinding(binding){this.handle=binding.handle;this.token=binding.token;}
  async listRecovery(){
    let base;try{base=await(await this.root()).getDirectoryHandle('waswan-daw-recovery-v3');}catch(error){if(error.name==='NotFoundError')return [];throw error;}
    const projects=[];
    for await(const [id,dir] of base.entries())if(dir.kind==='directory'&&safeId(id)){
      const candidates=[];for await(const [name,h] of dir.entries())if(h.kind==='file'&&/^[\w-]+\.wsmeta$/.test(name)){try{const file=await h.getFile(),{envelope}=await archiveHeader(file);if(envelope.project.id===id)candidates.push({id,name:envelope.project.name,modified:file.lastModified});}catch{}}
      candidates.sort((a,b)=>b.modified-a.modified);if(candidates.length)projects.push(candidates[0]);
    }
    return projects.sort((a,b)=>b.modified-a.modified);
  }
  async recoveryParts(dir,name){
    if(!/^[\w-]+\.wsmeta$/.test(name))throw Error('Invalid recovery generation name');
    const file=await(await dir.getFileHandle(name)).getFile(),{envelope,header}=await archiveHeader(file);
    if(file.size!==header.size)throw Error('Invalid recovery manifest');
    const sources=[],audio=await dir.getDirectoryHandle('audio');
    for(let i=0;i<envelope.project.assets.length;i++){
      const meta=envelope.project.assets[i],check=envelope.checksums[i],entry=recoveryName(meta,check),source=await(await audio.getFileHandle(entry)).getFile();
      const expected=new Uint8Array(wavHeader(meta.frames)),actual=new Uint8Array(await source.slice(0,44).arrayBuffer());
      if(source.size!==meta.bytes||actual.length!==44||!actual.every((v,j)=>v===expected[j]))throw Error('Incomplete recovery source');
      const key=envelope.project.id+':'+entry,cached=this.recoveryCache.get(key);
      if(!cached||cached.modified!==source.lastModified||cached.bytes!==source.size){
        if(await sourceChecksum(source)!==check.crc32)throw Error('Recovery source checksum mismatch');
        this.recoveryCache.set(key,{modified:source.lastModified,bytes:source.size});
      }
      sources.push(source);
    }
    return {header,sources,project:envelope.project};
  }
  async saveRecovery(controller){
    const document=controller.snapshot(),assets=new Map(controller.assets),blob=await projectBlob(document,assets);
    return this.exclusive('waswan-project-recovery-writer-v1',async()=>{
      const base=await(await this.root()).getDirectoryHandle('waswan-daw-recovery-v3',{create:true}),dir=await base.getDirectoryHandle(document.id,{create:true}),name=crypto.randomUUID()+'.wsmeta',audio=await dir.getDirectoryHandle('audio',{create:true}),{header,envelope}=await archiveHeader(blob);
      const index=await dir.getFileHandle('index.json',{create:true});let previous=[];
      try{previous=JSON.parse(await(await index.getFile()).text()).generations||[];}catch{}
      // Unchanged immutable sources are stored once; editing notes/faders saves
      // only a small manifest instead of rewriting hundreds of MB of audio.
      for(let i=0;i<document.assets.length;i++){
        const meta=document.assets[i],check=envelope.checksums[i],entry=recoveryName(meta,check);let intact=false;
        try{const source=await(await audio.getFileHandle(entry)).getFile(),cached=this.recoveryCache.get(document.id+':'+entry);intact=source.size===meta.bytes&&(cached?.modified===source.lastModified&&cached?.bytes===source.size||await sourceChecksum(source)===check.crc32);}catch{}
        if(!intact)await write(await audio.getFileHandle(entry,{create:true}),assets.get(meta.id));
      }
      await write(await dir.getFileHandle(name,{create:true}),header);
      await this.recoveryParts(dir,name);
      const keep=[name];
      const scanned=[];for await(const [entry,handle] of dir.entries())if(handle.kind==='file'&&entry!==name&&/^[\w-]+\.wsmeta$/.test(entry)){const file=await handle.getFile();scanned.push({entry,modified:file.lastModified});}
      scanned.sort((a,b)=>b.modified-a.modified||b.entry.localeCompare(a.entry));
      const candidates=new Set([...(Array.isArray(previous)?previous:[]),...scanned.map(file=>file.entry)]);
      for(const entry of candidates){
        if(entry===name)continue;
        if(typeof entry!=='string'||!/^[\w-]+\.wsmeta$/.test(entry))continue;
        try{const loaded=await this.recoveryParts(dir,entry);if(loaded.project.id===document.id){keep.push(entry);break;}}catch{}
      }
      await write(index,new Blob([JSON.stringify({version:1,generations:keep})]));
      for await(const [entry,handle] of dir.entries())if(handle.kind==='file'&&/^[\w-]+\.wsmeta$/.test(entry)&&!keep.includes(entry))await dir.removeEntry(entry);
      return {projectId:document.id,generations:keep.length};
    });
  }
  async recover(projectId,{accept=()=>true,deferBinding=false}={}){
    if(this.busy)throw Error('Finish the current file operation');this.busy=true;let loaded;
    try{
      loaded=await this.exclusive('waswan-project-recovery-writer-v1',()=>this.#readRecovery(projectId));
      if(!await accept(loaded)){await loaded.dispose();return null;}
      if(!deferBinding)this.forget();return loaded;
    }catch(error){await loaded?.dispose().catch(()=>{});throw error;}finally{this.busy=false;}
  }
  async #readRecovery(projectId){
    if(!safeId(projectId))throw Error('Invalid recovery project ID');
    const base=await(await this.root()).getDirectoryHandle('waswan-daw-recovery-v3'),dir=await base.getDirectoryHandle(projectId),files=[];
    for await(const [name,handle] of dir.entries())if(handle.kind==='file'&&/^[\w-]+\.wsmeta$/.test(name)){const file=await handle.getFile();files.push({name,file});}
    files.sort((a,b)=>b.file.lastModified-a.file.lastModified||b.name.localeCompare(a.name));
    // Prefer the committed generation order; scanning is recovery from a torn index.
    try{const names=JSON.parse(await(await(await dir.getFileHandle('index.json')).getFile()).text()).generations;if(Array.isArray(names))files.sort((a,b)=>{const rank=n=>names.includes(n)?names.indexOf(n):Number.MAX_SAFE_INTEGER;return rank(a.name)-rank(b.name);});}catch{}
    let lastError;
    for(const {name} of files){let assetStore;try{const parts=await this.recoveryParts(dir,name);assetStore=this.createAssetStore?await this.createAssetStore(await this.root()):null;const loaded=await readProject(new Blob([parts.header,...parts.sources]),{assetStore});if(loaded.project.id===projectId)return loaded;}catch(error){lastError=error;}await assetStore?.dispose().catch(()=>{});}
    throw Error('No intact recovery generation found'+(lastError?': '+lastError.message:''));
  }
}

export class RecoveryAutosave {
  constructor(controller,files,{delay=1500,onStatus=()=>{}}={}){
    Object.assign(this,{controller,files,delay,onStatus});this.closed=false;this.pending=false;this.saving=false;
    this.unsubscribe=controller.subscribe(({kind})=>{if(kind==='edit')this.schedule();});
  }
  schedule(){if(this.closed)return;this.pending=true;clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),this.delay);}
  async flush(){
    clearTimeout(this.timer);if(this.closed||this.saving||!this.pending)return;this.pending=false;this.saving=true;this.onStatus({state:'saving'});
    try{this.operation=this.files.saveRecovery(this.controller);await this.operation;if(!this.closed)this.onStatus({state:'saved'});}
    catch(error){if(!this.closed)this.onStatus({state:'error',message:error.message});}
    finally{this.saving=false;if(this.pending&&!this.closed)this.schedule();}
  }
  close(){this.closed=true;clearTimeout(this.timer);this.unsubscribe();return this.operation?.catch(()=>{});}
}
