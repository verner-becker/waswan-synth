// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/daw-mvp-wave-3';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1560,height:1100}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{
  window.audit={contexts:0,hosts:0,sent:[]};const AC=AudioContext;window.AudioContext=class extends AC{constructor(...args){super(...args);audit.context=this;audit.contexts++;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);if(args[1]==='waswan-daw-bus'){audit.bus=this;return;}if(args[1]!=='obervave-smk37')return;audit.node=this;audit.hosts++;const post=this.port.postMessage.bind(this.port);this.port.postMessage=(m,...rest)=>{audit.sent.push(m.t);post(m,...rest);};this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;if(m.t==='daw-state')audit.daw=m;});}};
  window.showSaveFilePicker=async()=>{const root=await navigator.storage.getDirectory();audit.savedHandle=await root.getFileHandle('daw-instrument-test.wsproj',{create:true});return audit.savedHandle;};
  window.showOpenFilePicker=async()=>[audit.savedHandle];
 });
 await page.goto('http://localhost:8737/simulator/?workspace=daw');const daw=page.locator('[data-view="daw"]'),button=name=>daw.getByRole('button',{name,exact:true}),field=name=>daw.getByLabel(name,{exact:true});
 assert(await daw.isVisible());assert(await page.locator('.ww-dock').isHidden());
 await page.getByRole('button',{name:'Start audio',exact:true}).click();await page.waitForFunction(()=>audit.frame?.ms>5000);await page.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
 await field('DAW project name').fill('Roundtrip composition');await field('DAW project name').press('Tab');
 for(let i=0;i<3;i++){
  await daw.getByRole('button',{name:'Mixer',exact:true}).click();
  await button('Add MIDI track').click();await page.waitForFunction(n=>document.querySelectorAll('.ww-daw-track').length===n,i+1);
  const row=daw.locator('.ww-daw-track').nth(i);await row.getByLabel('DAW track name').fill(['Piano','Bass','Lead'][i]);await row.getByLabel('DAW track name').press('Tab');
  await row.getByLabel('DAW instrument preset').selectOption(String([68,6,2][i]));await page.waitForFunction(()=>!document.querySelector('.ww-daw [aria-label="DAW note pitch"]').disabled);
  await row.getByRole('button',{name:'Select track',exact:true}).click();
  await daw.getByRole('button',{name:'Clip editor',exact:true}).click();
  await field('DAW note pitch').fill(String([60,48,67][i]));await field('DAW note start beat').fill('1');await field('DAW note duration beats').fill('16');await button('Add DAW note').click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="DAW notes"]').options.length===1);
 }
 await button('Play DAW').click();await page.waitForFunction(()=>audit.daw?.playing&&audit.frame.polyphony.slots.filter(v=>v.gate&&v.part>=4).length>=3);
 await page.evaluate(()=>{audit.raw=audit.context.createAnalyser();audit.node.connect(audit.raw,0);audit.mix=audit.context.createAnalyser();audit.bus.connect(audit.mix);});
 await page.waitForTimeout(250);
 const energy=await page.evaluate(()=>{const read=a=>{const b=new Float32Array(a.fftSize);a.getFloatTimeDomainData(b);return Math.max(...b.map(Math.abs));};return {raw:read(audit.raw),daw:read(audit.mix)};});assert(energy.daw>.001);assert.equal(energy.raw,0,'project notes are absent from the original stereo output');
 await page.evaluate(()=>{audit.node.port.postMessage({t:'voice-mode',part:0,mode:0});audit.node.port.postMessage({t:'midi',st:144,d1:72,d2:100});});await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===72));
 const profile=await page.evaluate(()=>localStorage.getItem('waswan-midi-profile-v1'));await page.evaluate(()=>{audit.sent=[];audit.keys=document.querySelector('#keys');});
 for(const id of ['perf','seq','tones','daw'])await page.locator(`[data-workspace="${id}"]`).click();
 assert.deepEqual(await page.evaluate(()=>audit.sent),[]);assert.equal(await page.evaluate(()=>audit.contexts),1);assert.equal(await page.evaluate(()=>audit.hosts),1);assert(await page.evaluate(()=>audit.keys===document.querySelector('#keys')));assert.equal(await page.evaluate(()=>localStorage.getItem('waswan-midi-profile-v1')),profile);
 await page.screenshot({path:`${root}/daw-foundation.png`,fullPage:true});
 await button('Stop DAW').click();await page.waitForFunction(()=>!audit.daw.playing&&audit.frame.polyphony.slots.filter(v=>v.gate&&v.part>=4).length===0);
 assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===72)));
 await button('Save DAW project').click();await page.waitForFunction(()=>document.querySelector('.ww-daw-status').textContent.includes('Project saved'));
 const saved=await page.evaluate(async()=>{const {readProject}=await import('/simulator/daw-format.js');const loaded=await readProject(await audit.savedHandle.getFile());return loaded.project;});assert.equal(saved.tracks.length,3);assert.equal(saved.clips.length,3);assert(saved.clips.every(c=>c.notes.length===1));assert(saved.tracks.every(t=>t.instrument.patch.length===80));
 await button('New DAW project').click();await page.waitForFunction(()=>document.querySelectorAll('.ww-daw-track').length===0);await button('Open DAW project').click();await page.waitForFunction(()=>document.querySelectorAll('.ww-daw-track').length===3);
 assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===72)),'opening project does not release the live Synth note');
 await button('Play DAW').click();await page.waitForFunction(()=>audit.daw.playing&&audit.frame.polyphony.slots.filter(v=>v.gate&&v.part>=4).length>=3);await page.waitForTimeout(250);
 const reopenedEnergy=await page.evaluate(()=>{const b=new Float32Array(audit.mix.fftSize);audit.mix.getFloatTimeDomainData(b);return Math.max(...b.map(Math.abs));});assert(reopenedEnergy>.001);
 await button('Stop DAW').click();await page.evaluate(()=>audit.node.port.postMessage({t:'midi',st:128,d1:72,d2:0}));
 assert.deepEqual(errors,[]);const report={result:'PASS',chrome:await browser.version(),sameContext:true,sameInstrumentNode:true,projectTracks:3,patchesAndNotesSaved:true,saveNewOpenPlay:true,reopenedEnergy,initialEnergy:energy,navigationSendsNoCommands:true,keyboardHiddenByDefault:true,stopAndOpenPreserveLiveNote:true,nativePickerInteraction:false,physicalValidation:false,errors};fs.writeFileSync(`${root}/browser-instruments.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
