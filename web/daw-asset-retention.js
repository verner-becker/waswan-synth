// SPDX-License-Identifier: GPL-3.0-only
// A source can still belong to Undo/Redo, the clip clipboard or an in-flight save.
export class DawAssetRetention {
  constructor(workspace){this.w=workspace;this.stores=new Set();}
  hold(assets,dispose){
    this.stores.add({files:[...assets.values()],dispose});
    this.schedule();
  }
  schedule(){
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>void this.collect(),100);
  }
  busy(){
    const w=this.w;
    return w.busy||w.auto?.saving||w.player.starting||w.importer?.busy||w.recorder?.busy||w.audioExport?.exporter.busy;
  }
  references(){
    const w=this.w,clipboard=w.clipTools?.clipboard;
    const wanted=new Set(w.controller.assets.values());
    if(clipboard?.projectId===w.snapshot.id)for(const source of clipboard.assets.values())wanted.add(source.blob);
    return wanted;
  }
  async collect(){
    if(this.collecting){this.pending=true;return;}
    if(this.busy())return;
    this.collecting=true;
    try{
      for(const store of [...this.stores]){
        if(this.busy())break;
        const wanted=this.references();
        if(store.files.some(file=>wanted.has(file)))continue;
        try{await store.dispose();this.stores.delete(store);}
        catch(error){this.w.recoveryStatus.textContent='Could not remove unused browser audio: '+error.message;}
      }
    }finally{
      this.collecting=false;
      if(this.pending){this.pending=false;this.schedule();}
    }
  }
}
