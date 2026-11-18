// SPDX-License-Identifier: GPL-3.0-only
import {emptyProject,validateProject,makeTrack,uuid} from './daw-project.js';
const clone=value=>structuredClone(value);
const fail=(code,message)=>{const error=Error(message);error.code=code;throw error;};
const find=(items,id,label)=>items.find(item=>item.id===id)||fail('NOT_FOUND',`${label} not found`);
const fields=(target,changes,allowed)=>{for(const key of Object.keys(changes))if(!allowed.includes(key))fail('INVALID_COMMAND',`Cannot change ${key}`);Object.assign(target,clone(changes));};
function apply(p,type,data){
  if(type==='batch'){if(!Array.isArray(data.commands)||data.commands.length>512)fail('INVALID_COMMAND','Invalid transaction');for(const c of data.commands){if(c.type==='batch')fail('INVALID_COMMAND','Nested transactions are not supported');apply(p,c.type,c.payload);}return;}
  if(type==='project.update')return fields(p,data,['name','bpm','meter','length']);
  if(type==='track.create'){const t={...makeTrack(data.type,data.name),...clone(data)};p.tracks.push(t);return;}
  if(type==='track.update')return fields(find(p.tracks,data.id,'Track'),data.changes,['name','icon','color','volume','pan','mute','solo','monitor','instrument','fx']);
  if(type==='track.remove'){find(p.tracks,data.id,'Track');p.tracks=p.tracks.filter(t=>t.id!==data.id);p.clips=p.clips.filter(c=>c.trackId!==data.id);p.automation=p.automation.filter(l=>l.trackId!==data.id);return;}
  if(type==='track.move'){const t=find(p.tracks,data.id,'Track');if(!Number.isInteger(data.index)||data.index<0||data.index>=p.tracks.length)fail('INVALID_COMMAND','Invalid track order');p.tracks.splice(p.tracks.indexOf(t),1);p.tracks.splice(data.index,0,t);return;}
  if(type==='track.duplicate'){
    const old=find(p.tracks,data.id,'Track'),t={...clone(old),id:uuid(),name:(old.name+' copy').slice(0,80)};p.tracks.push(t);
    if(data.clips)for(const c of [...p.clips])if(c.trackId===old.id)p.clips.push({...clone(c),id:uuid(),trackId:t.id});
    for(const lane of [...p.automation])if(lane.trackId===old.id)p.automation.push({...clone(lane),id:uuid(),trackId:t.id});return;
  }
  if(type==='asset.add'){p.assets.push(clone(data));return;}
  if(type==='asset.remove'){find(p.assets,data.id,'Source');if(p.clips.some(c=>c.assetId===data.id))fail('SOURCE_IN_USE','Audio source is still used by a clip');p.assets=p.assets.filter(a=>a.id!==data.id);return;}
  if(type==='clip.add'){p.clips.push(clone(data));return;}
  if(type==='clip.update')return fields(find(p.clips,data.id,'Clip'),data.changes,['name','trackId','position','offset','frames','gain','pan','fadeIn','fadeOut','length','loopLength','loop','notes']);
  if(type==='clip.remove'){find(p.clips,data.id,'Clip');p.clips=p.clips.filter(c=>c.id!==data.id);return;}
  if(type==='clip.duplicate'){const c=find(p.clips,data.id,'Clip');p.clips.push({...clone(c),id:uuid(),position:clone(data.position||c.position)});return;}
  if(type==='note.add'){const c=find(p.clips,data.clipId,'Clip');if(c.type!=='midi')fail('INVALID_COMMAND','Select a MIDI clip');c.notes.push(clone(data.note));return;}
  if(type==='note.update'){const c=find(p.clips,data.clipId,'Clip');return fields(find(c.notes||[],data.id,'Note'),data.changes,['pitch','velocity','start','duration']);}
  if(type==='note.remove'){const c=find(p.clips,data.clipId,'Clip');find(c.notes||[],data.id,'Note');c.notes=c.notes.filter(n=>n.id!==data.id);return;}
  if(type==='marker.add'){p.markers.push(clone(data));return;}
  if(type==='marker.update')return fields(find(p.markers,data.id,'Marker'),data.changes,['name','tick']);
  if(type==='marker.remove'){find(p.markers,data.id,'Marker');p.markers=p.markers.filter(m=>m.id!==data.id);return;}
  if(type==='automation.add'){p.automation.push(clone(data));return;}
  if(type==='automation.update')return fields(find(p.automation,data.id,'Automation'),data.changes,['enabled','curve','points']);
  if(type==='automation.remove'){find(p.automation,data.id,'Automation');p.automation=p.automation.filter(a=>a.id!==data.id);return;}
  if(type==='master.update')return fields(p.master,data,['volume','fx']);
  fail('UNKNOWN_COMMAND','Unknown project command');
}
export class ProjectController {
  #project;#revision=0;#saved;#past=[];#future=[];#commands=new Map();#listeners=new Set();#assets;#merge=null;
  constructor(project=emptyProject(),assets=new Map()){
    validateProject(project);this.#assets=new Map(assets);this.#checkAssets(project);this.#project=clone(project);this.#saved=JSON.stringify(project);
  }
  #checkAssets(p){for(const a of p.assets){const blob=this.#assets.get(a.id);if(!(blob instanceof Blob)||blob.size!==a.bytes)fail('MISSING_SOURCE','Missing or incomplete audio source');}}
  get assets(){return new Map(this.#assets);}
  get revision(){return this.#revision;}
  get dirty(){return JSON.stringify(this.#project)!==this.#saved;}
  get canUndo(){return this.#past.length>0;}
  get canRedo(){return this.#future.length>0;}
  snapshot(){return clone(this.#project);}
  subscribe(listener){this.#listeners.add(listener);return ()=>this.#listeners.delete(listener);}
  #notify(kind,type){for(const listener of this.#listeners){try{listener({kind,type,revision:this.#revision,dirty:this.dirty});}catch(error){queueMicrotask(()=>{throw error;});}}}
  markUnsaved(){this.#saved=null;this.#notify('unsaved');}
  markSaved(document){validateProject(document);if(document.id!==this.#project.id)fail('WRONG_PROJECT','Save belongs to a different project');this.#saved=JSON.stringify(document);this.#merge=null;this.#notify('saved');}
  endCoalescing(){this.#merge=null;}
  execute({id,projectId,expectedRevision,type,payload={},mergeKey}){
    if(typeof id!=='string'||!id.length||id.length>100||typeof type!=='string'||!payload||typeof payload!=='object'||Array.isArray(payload))fail('INVALID_COMMAND','Invalid command envelope');
    if(mergeKey!==undefined&&(typeof mergeKey!=='string'||!mergeKey.length||mergeKey.length>160))fail('INVALID_COMMAND','Invalid edit gesture');
    if(projectId!==this.#project.id)fail('WRONG_PROJECT','Command belongs to a different project');
    const fingerprint=JSON.stringify({projectId,expectedRevision,type,payload,mergeKey}),prior=this.#commands.get(id);
    if(fingerprint.length>16*1024*1024)fail('INVALID_COMMAND','Command metadata is too large');
    if(prior){if(prior.fingerprint!==fingerprint)fail('DUPLICATE_ID','Command ID was reused with different data');return clone(prior.result);}
    if(expectedRevision!==this.#revision)fail('REVISION_CONFLICT','Project changed; refresh before retrying');
    if(type==='undo'||type==='redo'){
      this.#merge=null;
      const from=type==='undo'?this.#past:this.#future,to=type==='undo'?this.#future:this.#past;
      if(!from.length)fail('EMPTY_HISTORY','No edit to '+type);to.push(this.#project);this.#project=from.pop();
    }else{
      const next=clone(this.#project);apply(next,type,payload);validateProject(next);this.#checkAssets(next);
      const now=performance.now(),merge=typeof mergeKey==='string'&&mergeKey.length<=160&&this.#merge?.key===mergeKey&&this.#merge.revision===this.#revision&&now-this.#merge.time<400&&this.#past.length>0;
      if(!merge)this.#past.push(this.#project);this.#future=[];this.#project=next;this.#merge=mergeKey?{key:mergeKey,revision:this.#revision+1,time:now}:null;
    }
    this.#revision++;
    // Bounded metadata history. Audio is immutable and retained by reference.
    let bytes=this.#past.reduce((n,p)=>n+JSON.stringify(p).length*2,0);
    while(this.#past.length>64||bytes>32*1024*1024){const removed=this.#past.shift();bytes-=JSON.stringify(removed).length*2;}
    const result={revision:this.#revision,projectId:this.#project.id};this.#commands.set(id,{fingerprint,result});
    let commandBytes=0;for(const entry of this.#commands.values())commandBytes+=entry.fingerprint.length*2;
    while(this.#commands.size>256||commandBytes>32*1024*1024){const first=this.#commands.keys().next().value;commandBytes-=this.#commands.get(first).fingerprint.length*2;this.#commands.delete(first);}
    this.collectAssets();this.#notify('edit',type);return clone(result);
  }
  command(type,payload={},options={}){return this.execute({id:uuid(),projectId:this.#project.id,expectedRevision:this.#revision,type,payload,mergeKey:options.mergeKey});}
  addAsset(meta,blob){
    if(this.#assets.has(meta.id))fail('DUPLICATE_ID','Audio source already exists');this.#assets.set(meta.id,blob);
    try{return this.command('asset.add',meta);}catch(error){this.#assets.delete(meta.id);throw error;}
  }
  collectAssets(){const retained=new Set([this.#project,...this.#past,...this.#future].flatMap(p=>p.assets.map(a=>a.id)));for(const id of this.#assets.keys())if(!retained.has(id))this.#assets.delete(id);}
  clearHistory(){this.#past=[];this.#future=[];this.#commands.clear();this.#merge=null;this.collectAssets();}
}
