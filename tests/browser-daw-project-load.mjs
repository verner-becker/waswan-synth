// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root='.local/validation/daw-mvp-wave-2';fs.mkdirSync(root,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'waswan-daw-load-'));
const privateMode=process.env.DAW_LOAD_PRIVATE==='1',browser=privateMode?await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}):null;
const context=privateMode?await browser.newContext():await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/google-chrome',headless:true});
const copyMode=process.env.DAW_LOAD_COPY==='1';
try{
 const page=context.pages()[0]||await context.newPage();page.on('console',m=>console.log(m.text()));await page.goto('http://localhost:8737/simulator/');
 const report=await page.evaluate(async copyMode=>{
  const {emptyProject,makeTrack,uuid}=await import('/simulator/daw-project.js'),{ProjectController}=await import('/simulator/daw-controller.js'),{ProjectFiles}=await import('/simulator/daw-files.js'),{projectBlob,readProject}=await import('/simulator/daw-format.js'),{ImmutableAudioStore}=await import('/simulator/daw-assets.js'),{wavHeader}=await import('/simulator/studio-format.js');
  console.log('storage: '+JSON.stringify(await navigator.storage.estimate()));const p=emptyProject(),library=new Map(),frames=44100*300,started=performance.now();p.length=960*600;
  for(let i=0;i<3;i++)p.tracks.push(makeTrack('midi','Instrument '+i));
  for(let i=0;i<5;i++){
    const track=makeTrack('audio','Stem '+i),id=uuid(),block=Int16Array.from({length:44100*2},(_,n)=>(n*17+i*211)%4096-2048),audio=new Blob([wavHeader(frames),...Array(300).fill(block)]);
    p.tracks.push(track);p.assets.push({id,name:'Five minute stem '+i,sampleRate:44100,channels:2,frames,bytes:audio.size});library.set(id,audio);
    p.clips.push({id:uuid(),type:'audio',trackId:track.id,name:'Stem '+i,assetId:id,position:{unit:'seconds',value:0},offset:0,frames,gain:1,pan:0,fadeIn:0,fadeOut:0});
  }
  console.log('stage: sources allocated');const controller=new ProjectController(p,library);
  for(let i=0;i<32;i++)controller.command('project.update',{name:'Edit '+i});
  for(let i=0;i<32;i++)controller.command('undo');
  if(controller.snapshot().name!==p.name)throw Error('History did not restore the composition');
  console.log('stage: serialize');const encoded=await projectBlob(controller.snapshot(),controller.assets),encodedMs=performance.now()-started;console.log('stage: serialized '+encoded.size);
  const storage=await navigator.storage.getDirectory(),name='waswan-daw-large-'+uuid()+'.wsproj',assetStore=copyMode?null:await ImmutableAudioStore.create(storage);
  try{
    const handle=await storage.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write(encoded);await writer.close();console.log('stage: OPFS write closed');
    const loaded=await readProject(await handle.getFile(),{assetStore});console.log('stage: archive read');
    if(loaded.project.tracks.length!==8||loaded.assets.size!==5)throw Error('Archive lost tracks or sources');
    for(let i=0;i<5;i++){
      const source=loaded.assets.get(p.assets[i].id);console.log('stage: read immutable source '+i+' bytes '+source.size);
      const first=new Int16Array(await source.slice(44,44+64).arrayBuffer()),last=new Int16Array(await source.slice(source.size-44100*4,source.size-44100*4+64).arrayBuffer());
      if(!first.every((v,n)=>v===(n*17+i*211)%4096-2048&&v===last[n]))throw Error('Source boundary bytes changed');
    }
    console.log('stage: large Undo');const ctrl=new ProjectController(loaded.project,loaded.assets);ctrl.command('batch',{commands:[{type:'clip.remove',payload:{id:p.clips[0].id}},{type:'asset.remove',payload:{id:p.assets[0].id}}]});ctrl.command('undo');
    if(ctrl.assets.get(p.assets[0].id).size!==p.assets[0].bytes)throw Error('Undo lost large source');
    const files=new ProjectFiles({root:async()=>storage});await files.saveRecovery(ctrl);
    const recovery=await(await storage.getDirectoryHandle('waswan-daw-recovery-v3')).getDirectoryHandle(p.id),audio=await recovery.getDirectoryHandle('audio'),versions=new Map();
    for await(const [entry,h] of audio.entries()){const f=await h.getFile();versions.set(entry,{size:f.size,modified:f.lastModified});}
    ctrl.command('project.update',{name:'Incremental autosave'});const again=performance.now();await files.saveRecovery(ctrl);const secondAutosaveMs=performance.now()-again;
    let audioFiles=0;for await(const [entry,h] of audio.entries()){const f=await h.getFile(),old=versions.get(entry);if(!old||old.size!==f.size||old.modified!==f.lastModified)throw Error('Unchanged audio was rewritten by autosave');audioFiles++;}
    if(audioFiles!==5)throw Error('Autosave duplicated source files');
    return {result:'PASS',audioSources:5,secondsPerSource:300,logicalTracks:8,archiveBytes:encoded.size,encodeAndHistoryMs:encodedMs,totalMs:performance.now()-started,checksumValidatedOnRead:true,largeAssetUndo:true,incrementalAutosaveAudioFiles:audioFiles,secondAutosaveMs,musicalPlaybackTest:false,totalNativeMemoryMeasured:false};
  }finally{await assetStore?.dispose();await storage.removeEntry(name);try{await(await storage.getDirectoryHandle('waswan-daw-recovery-v3')).removeEntry(p.id,{recursive:true});}catch{}}
 },copyMode);
 fs.writeFileSync(`${root}/project-load${privateMode?'-private':''}.json`,JSON.stringify({chrome:context.browser()?.version(),profile:privateMode?'temporary-private':'temporary-persistent',...report},null,2));console.log(JSON.stringify(report));
}finally{await context.close();await browser?.close();fs.rmSync(profile,{recursive:true,force:true});}
