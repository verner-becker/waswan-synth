// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {ProjectController} from '../web/daw-controller.js';
import {ProjectFiles,RecoveryAutosave} from '../web/daw-files.js';
import {readProject} from '../web/daw-format.js';
class Handle {
  constructor(){this.name='song.wsproj';this.data=new Blob();this.permission='granted';}
  async getFile(){return this.data;}
  async requestPermission(){return this.permission;}
  async createWritable(){
    if(this.fail==='open')throw Error('Quota exceeded');const handle=this;let pending;
    return {async write(blob){if(handle.fail==='write')throw Error('Write failed');pending=blob;await handle.onWrite?.();},async close(){if(handle.fail==='close')throw Error('Commit failed');handle.data=pending;},async abort(){handle.aborted=true;}};
  }
}
let held=false;const locks={async request(name,options,callback){if(held)return callback(null);held=true;try{return await callback({name});}finally{held=false;}}};
const handle=new Handle(),files=new ProjectFiles({savePicker:async()=>handle,openPicker:async()=>[handle],locks}),c=new ProjectController();c.command('project.update',{name:'First'});
await files.save(c);assert(!c.dirty);assert.equal((await readProject(handle.data)).project.name,'First');
const before=await handle.data.arrayBuffer();
for(const failure of ['open','write','close']){
 c.command('project.update',{name:'After '+failure});handle.fail=failure;await assert.rejects(files.save(c));assert(c.dirty);assert.deepEqual(await handle.data.arrayBuffer(),before);
}
handle.fail=null;handle.permission='denied';await assert.rejects(files.save(c),/permission/);assert(c.dirty);handle.permission='granted';
const rejectedHandle=new Handle();rejectedHandle.data=handle.data;files.openPicker=async()=>[rejectedHandle];assert.equal(await files.open({accept:()=>false}),null);assert.equal(files.handle,handle,'cancel replacement must not change the Save destination');
files.savePicker=async()=>{throw new DOMException('Cancelled','AbortError');};await assert.rejects(files.save(c,{saveAs:true}),{name:'AbortError'});assert.equal(files.handle,handle);
handle.onWrite=()=>c.command('project.update',{name:'Edited during Save'});
const result=await files.save(c);assert(c.dirty);assert(result.dirty);assert.equal((await readProject(handle.data)).project.name,'After close');handle.onWrite=null;
const a=new ProjectFiles({openPicker:async()=>[handle],locks}),b=new ProjectFiles({openPicker:async()=>[handle],locks});
const loadedA=await a.open(),loadedB=await b.open(),ca=new ProjectController(loadedA.project,loadedA.assets),cb=new ProjectController(loadedB.project,loadedB.assets);
ca.command('project.update',{name:'Writer A'});cb.command('project.update',{name:'Writer B'});await a.save(ca);await assert.rejects(b.save(cb),/changed outside/);assert(cb.dirty);assert.equal((await readProject(handle.data)).project.name,'Writer A');
const statuses=[],auto=new RecoveryAutosave(c,{saveRecovery:async()=>{throw Error('Recovery quota');}},{delay:5,onStatus:s=>statuses.push(s)});
c.command('project.update',{name:'Autosave attempt'});await new Promise(resolve=>setTimeout(resolve,25));assert.equal(statuses.at(-1).state,'error');assert(c.dirty);auto.close();
console.log('PASS file lifecycle: write/commit/quota/permission failure preserve bytes and dirty; cancel Save As, editing during Save, stale writer rejection, autosave error');
