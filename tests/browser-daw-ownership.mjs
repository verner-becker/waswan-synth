// SPDX-License-Identifier: GPL-3.0-only
import {clickDawFile} from './daw-browser-controls.mjs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {wavHeader} from '../web/studio-format.js';
const root='.local/validation/daw-mvp-wave-3';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1560,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{
  window.audit={sources:0,sent:[],changes:[]};const AC=AudioContext;window.AudioContext=class extends AC{createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...a)=>{audit.sources++;return start(...a);};return source;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...a){super(...a);if(a[1]!=='obervave-smk37')return;audit.node=this;const post=this.port.postMessage.bind(this.port);this.port.postMessage=(m,...rest)=>{audit.sent.push(m.t);post(m,...rest);};this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;if(m.t==='daw-state')audit.state=m;if(m.t==='daw-instruments-changed')audit.changes.push(m);if(m.t==='daw-reply')audit.reply=m;});}};
  window.showOpenFilePicker=async()=>[audit.handle];window.showSaveFilePicker=async()=>audit.handle;
 });
 await page.goto('http://localhost:8737/simulator/?workspace=daw');await page.getByRole('button',{name:'Start audio',exact:true}).click();await page.waitForFunction(()=>audit.frame?.ms>5000);await page.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
 await page.evaluate(async()=>{
  const {emptyProject,makeTrack,uuid}=await import('/simulator/daw-project.js'),{projectBlob}=await import('/simulator/daw-format.js');
  const request=crypto.randomUUID(),reply=new Promise(resolve=>{const listener=({data:m})=>{if(m.t==='daw-reply'&&m.request===request){audit.node.port.removeEventListener('message',listener);resolve(m.result);}};audit.node.port.addEventListener('message',listener);});audit.node.port.postMessage({t:'daw-program',request,program:68});const sound=await reply;
  const p=emptyProject();p.name='Six independent instruments';p.length=64*960;
  for(let i=0;i<6;i++){const t=makeTrack('midi','Instrument '+i);t.instrument={type:'analog',patch:[...sound.patch]};p.tracks.push(t);p.clips.push({id:uuid(),type:'midi',trackId:t.id,name:t.name,position:{unit:'ticks',value:0},length:p.length,loopLength:p.length,loop:false,notes:[{id:uuid(),pitch:48+i*3,velocity:80,start:0,duration:p.length}]});}
  const dir=await navigator.storage.getDirectory();audit.handle=await dir.getFileHandle('ownership.wsproj',{create:true});const writer=await audit.handle.createWritable();await writer.write(await projectBlob(p,new Map()));await writer.close();
 });
 const daw=page.locator('.ww-daw'),button=name=>daw.getByRole('button',{name,exact:true});
 await clickDawFile(daw,'Open DAW project');await page.waitForFunction(()=>document.querySelectorAll('.ww-daw-track').length===6);await button('Play DAW').click();await page.waitForFunction(()=>audit.state?.playing&&new Set(audit.frame.polyphony.slots.filter(v=>v.gate&&v.sequenced).map(v=>v.part)).size===6);
 // This is an accepted semantic edit, after pickup, on a base slot shared with Synth.
 await page.evaluate(()=>audit.node.port.postMessage({t:'ui-control',source:'ui',id:0,value:55,scope:audit.frame.instrument.scope}));
 await page.waitForFunction(()=>audit.changes.some(m=>m.changes.some(c=>c.part===0&&c.patch[12]===55)));
 await clickDawFile(daw,'Save DAW project');await page.waitForFunction(()=>document.querySelector('.ww-daw-status').textContent.startsWith('Project saved'));
 const patches=await page.evaluate(async()=>{const {readProject}=await import('/simulator/daw-format.js');return (await readProject(await audit.handle.getFile())).project.tracks.map(t=>t.instrument.patch[12]);});assert.equal(patches[4],55);assert.equal(patches.filter(v=>v===55).length,1,'only the actual shared slot follows the edit');
 await page.locator('[data-workspace="seq"]').click();await page.locator('.ww-sequence > details').evaluateAll(ns=>ns.forEach(n=>n.open=true));
 const wav=Buffer.from(await new Blob([wavHeader(4410),new Int16Array(8820)]).arrayBuffer());await page.getByLabel('Import audio WAV',{exact:true}).setInputFiles({name:'overlap.wav',mimeType:'audio/wav',buffer:wav});await page.waitForFunction(()=>document.querySelector('[aria-label="Audio clips"]').options.length===1);
 const mark=await page.evaluate(()=>({sources:audit.sources,starts:audit.sent.filter(t=>t==='studio-sequence-start').length}));await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ww-sequence-status').textContent.includes('Stop DAW'));
 assert.deepEqual(await page.evaluate(()=>({sources:audit.sources,starts:audit.sent.filter(t=>t==='studio-sequence-start').length})),mark,'Studio rejects before scheduling audio or click');
 await page.evaluate(()=>audit.node.port.postMessage({t:'studio-context-apply',context:{}}));await page.waitForTimeout(100);assert(await page.evaluate(()=>audit.state.playing));
 await page.locator('[data-workspace="daw"]').click();await button('Stop DAW').click();await page.waitForFunction(()=>!audit.state.playing);
 await page.evaluate(()=>audit.node.port.postMessage({t:'reboot'}));await page.waitForFunction(()=>audit.frame?.ms<5000);await page.waitForFunction(()=>audit.frame?.ms>5000);
 await clickDawFile(daw,'Save DAW project');await page.waitForFunction(()=>document.querySelector('.ww-daw-status').textContent.startsWith('Project saved'));
 assert.deepEqual(await page.evaluate(async()=>{const {readProject}=await import('/simulator/daw-format.js');return (await readProject(await audit.handle.getFile())).project.tracks.map(t=>t.instrument.patch[12]);}),patches,'reboot does not capture reset engine bytes as project edits');assert.deepEqual(errors,[]);
 const report={result:'PASS',sixSimultaneousInstruments:true,acceptedSharedSynthEditSaved:true,unrelatedPatchesUnchanged:true,studioStartSchedulesNoSourcesWhileDawPlays:true,rebootPreservesProjectPatches:true,physicalValidation:false,errors};fs.writeFileSync(`${root}/browser-ownership.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
