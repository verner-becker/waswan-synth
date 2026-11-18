// SPDX-License-Identifier: GPL-3.0-only
// A private import directory owns immutable copies, separate from the user's
// project file. Do not dispose while a controller/export still owns these Files.
export class ImmutableAudioStore {
  static async create(root){
    root??=await navigator.storage.getDirectory();
    await this.cleanup(root);
    const base=await root.getDirectoryHandle('waswan-daw-imports-v1',{create:true}),name=crypto.randomUUID();
    let release,held;
    await new Promise((resolve,reject)=>{held=navigator.locks.request('waswan-import-'+name,()=>new Promise(done=>{release=done;resolve();})).catch(reject);});
    try{const dir=await base.getDirectoryHandle(name,{create:true});return new ImmutableAudioStore(base,name,dir,async()=>{release();await held;});}
    catch(error){release();await held;throw error;}
  }
  static async cleanup(root){
    return navigator.locks.request('waswan-import-cleanup-v1',{ifAvailable:true},async lock=>{
      if(!lock)return;const base=await root.getDirectoryHandle('waswan-daw-imports-v1',{create:true});
      for await(const [name,handle] of base.entries())if(handle.kind==='directory'&&/^[0-9a-f-]{36}$/.test(name))await navigator.locks.request('waswan-import-'+name,{ifAvailable:true},async lease=>{if(lease)await base.removeEntry(name,{recursive:true});});
    });
  }
  constructor(base,name,dir,release){Object.assign(this,{base,name,dir,release});this.closed=false;}
  async copy(source){
    if(this.closed)throw Error('Audio import storage was closed');
    const handle=await this.dir.getFileHandle(crypto.randomUUID()+'.wav',{create:true}),writer=await handle.createWritable();
    try{await writer.write(source);await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}
    return handle.getFile();
  }
  async dispose(){if(this.closed)return;this.closed=true;try{await this.base.removeEntry(this.name,{recursive:true});}finally{await this.release();}}
}
