// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='.local/validation/daw-mvp-wave-2';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8737/simulator/');
 const report=await page.evaluate(async()=>{
  const {emptyProject,makeTrack,uuid}=await import('/simulator/daw-project.js'),{ProjectController}=await import('/simulator/daw-controller.js'),{ProjectFiles,RecoveryAutosave}=await import('/simulator/daw-files.js'),{ImmutableAudioStore}=await import('/simulator/daw-assets.js'),{wavHeader}=await import('/simulator/studio-format.js'),{readProject,fileToken}=await import('/simulator/daw-format.js');
  const parent=await navigator.storage.getDirectory(),name='waswan-daw-files-test-'+uuid(),dir=await parent.getDirectoryHandle(name,{create:true});
  let completed=false;
  try{
   const p=emptyProject(),track=makeTrack('audio');p.tracks.push(track);
   const pcm=Int16Array.from({length:1024},(_,i)=>i*7),audio=new Blob([wavHeader(512),pcm]),asset={id:uuid(),name:'Undo source',sampleRate:44100,channels:2,frames:512,bytes:audio.size};p.assets.push(asset);
   p.clips.push({id:uuid(),type:'audio',trackId:track.id,name:'Source',assetId:asset.id,position:{unit:'seconds',value:0},offset:0,frames:512,gain:1,pan:0,fadeIn:0,fadeOut:0});
   const controller=new ProjectController(p,new Map([[asset.id,audio]])),handle=await dir.getFileHandle('portable.wsproj',{create:true}),files=new ProjectFiles({savePicker:async()=>handle,openPicker:async()=>[handle],root:async()=>dir});
   controller.command('project.update',{name:'Portable'});await files.save(controller);if(controller.dirty)throw Error('Successful save stayed dirty');
   const initialToken=await fileToken(await handle.getFile()),abort=await handle.createWritable();await abort.write(new Blob(['incomplete']));await abort.abort();
   if(await fileToken(await handle.getFile())!==initialToken)throw Error('Abort replaced the original file');
   const loaded=await files.open(),opened=new ProjectController(loaded.project,loaded.assets);
   opened.command('clip.remove',{id:p.clips[0].id});opened.command('asset.remove',{id:asset.id});opened.command('undo');opened.command('undo');
   const same=async blob=>{const actual=new Int16Array((await blob.arrayBuffer()).slice(44));return actual.every((n,i)=>n===pcm[i]);};
   if(!await same(opened.assets.get(asset.id)))throw Error('Undo lost source bytes');
   // Replacing the selected user file must not invalidate imported source blobs.
   opened.command('project.update',{name:'Replacement'});await files.save(opened);
   if(!await same(loaded.assets.get(asset.id)))throw Error('Imported source depends on overwritten file');
   const cache=await dir.getDirectoryHandle('waswan-daw-imports-v1'),orphan=uuid();await cache.getDirectoryHandle(orphan,{create:true});await ImmutableAudioStore.cleanup(dir);
   let orphanExists=true;try{await cache.getDirectoryHandle(orphan);}catch{orphanExists=false;}
   if(orphanExists||!await same(loaded.assets.get(asset.id)))throw Error('Import cleanup must remove orphans and preserve active leases');
   opened.command('project.update',{name:'Generation one'});await files.saveRecovery(opened);
   opened.command('project.update',{name:'Generation two'});await files.saveRecovery(opened);
   const recovery=await(await dir.getDirectoryHandle('waswan-daw-recovery-v3')).getDirectoryHandle(p.id),index=JSON.parse(await(await(await recovery.getFileHandle('index.json')).getFile()).text());
   const latest=await recovery.getFileHandle(index.generations[0]),writer=await latest.createWritable();await writer.write(new Blob(['corrupted']));await writer.close();
   const restored=await files.recover(p.id);if(restored.project.name!=='Generation one'||!await same(restored.assets.get(asset.id)))throw Error('Previous recovery generation failed');
   const status=[],auto=new RecoveryAutosave(opened,files,{delay:50,onStatus:s=>status.push(s.state)});opened.command('project.update',{name:'Autosaved'});
   for(let i=0;i<100&&!status.includes('saved');i++)await new Promise(resolve=>setTimeout(resolve,20));auto.close();
   if(!status.includes('saved')||!opened.dirty)throw Error('Autosave must succeed without clearing file dirty');
   const after=await files.recover(p.id);if(after.project.name!=='Autosaved')throw Error('Autosave did not recover latest edit');
   const nextIndex=JSON.parse(await(await(await recovery.getFileHandle('index.json')).getFile()).text()),breakNewest=await(await recovery.getFileHandle(nextIndex.generations[0])).createWritable();
   await breakNewest.write(new Blob(['also corrupted']));await breakNewest.close();
   if((await files.recover(p.id)).project.name!=='Generation one')throw Error('Autosave discarded the validated fallback');
   const torn=await(await recovery.getFileHandle('index.json')).createWritable();await torn.write(new Blob(['broken index']));await torn.close();
   await files.saveRecovery(opened);
   const repaired=JSON.parse(await(await(await recovery.getFileHandle('index.json')).getFile()).text()),latestBroken=await(await recovery.getFileHandle(repaired.generations[0])).createWritable();
   await latestBroken.write(new Blob(['bad after torn index']));await latestBroken.close();
   if((await files.recover(p.id)).project.name!=='Generation one')throw Error('Torn index cleanup deleted the intact fallback');
   const named=structuredClone(p);named.id='song-other';const other=new ProjectController(named,new Map([[asset.id,audio]]));await files.saveRecovery(other);
   named.id='song';const prefix=new ProjectController(named,new Map([[asset.id,audio]]));await files.saveRecovery(prefix);
   if((await files.recover('song-other')).project.id!=='song-other')throw Error('Recovery cleanup crossed project boundaries');
   let release,held;await new Promise(resolve=>{held=navigator.locks.request('waswan-project-recovery-writer-v1',()=>new Promise(done=>{release=done;resolve();}));});
   let blocked=false;try{await files.recover(p.id);}catch(error){blocked=error.message.includes('in progress');}finally{release();await held;}
   if(!blocked)throw Error('Recovery did not coordinate with the autosave writer');
   const bytes=await handle.getFile();await readProject(bytes);
   completed=true;return {result:'PASS',scope:name,projectId:p.id,abortPreservesPreviousFile:true,undoPreservesAudioBytes:true,sourceSurvivesFileReplacement:true,corruptGenerationFallsBack:true,validatedFallbackSurvivesAutosave:true,tornIndexPreservesFallback:true,projectDirectoriesIsolated:true,sharedRecoveryLock:true,autosaveSeparateFromSave:true,opfsNativeWrites:true,nativePickerInteraction:false,windowsMacPhysicalValidation:false};
  }finally{if(!completed)await parent.removeEntry(name,{recursive:true});}
 });
 await page.reload();
 report.recoveredAfterReload=await page.evaluate(async({scope,projectId})=>{
  const {ProjectFiles}=await import('/simulator/daw-files.js'),parent=await navigator.storage.getDirectory(),dir=await parent.getDirectoryHandle(scope);
  try{const loaded=await new ProjectFiles({root:async()=>dir}).recover(projectId);if(loaded.project.name!=='Generation one')throw Error('Reload lost intact fallback');await loaded.dispose();return true;}
  finally{await parent.removeEntry(scope,{recursive:true});}
 },report);
 assert.equal(report.result,'PASS');fs.writeFileSync(`${root}/browser-files.json`,JSON.stringify({chrome:await browser.version(),...report},null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
