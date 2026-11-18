// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root='.local/validation/tone-editor-v1';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({viewport:{width:1560,height:1100}}),p=await context.newPage(),errors=[];p.setDefaultTimeout(25000);p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await p.addInitScript(()=>{
  window.audit={contexts:0,sent:[]};const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;audit.contexts++;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);audit.node=this;const send=this.port.postMessage.bind(this.port);this.port.postMessage=m=>{audit.sent.push(structuredClone(m));send(m);};this.port.addEventListener('message',({data:m})=>{if(m.t==='frame'){audit.frame=m;if(m.editorCatalog)audit.catalog=m.editorCatalog;if(m.programLibrary)audit.library=m.programLibrary;}});}};
  audit.profile=JSON.stringify({version:1,enabled:true,bindings:[{port:'Synthetic MIDI',channel:0,cc:48,target:'enc:0',mode:'absolute',behavior:'fine'}]});localStorage.setItem('waswan-midi-profile-v1',audit.profile);
});
const send=m=>p.evaluate(m=>audit.node.port.postMessage(m),m),editor=p.locator('.ww-tone-editor'),dialog=p.locator('.ww-editor-save');
const group=name=>editor.locator('.ww-editor-tabs').getByRole('button',{name,exact:true}).click();
const setNumber=async(id,value)=>{const input=editor.locator(`[data-param="${id}"] input[type="number"]`);await input.fill(String(value));await input.press('Tab');await p.waitForFunction(([id,value])=>audit.frame.editor.values[id].value===value,[id,value]);};
const start=async()=>{await p.getByRole('button',{name:'Start audio',exact:true}).click();await p.locator('.ww-midi-setup[open]').waitFor();await p.locator('.ww-midi-setup').locator('.ww-midi-continue').click();await p.waitForFunction(()=>audit.frame?.editor?.available);await p.locator('[data-workspace="tones"]').click();await p.evaluate(()=>{audit.startMark=audit.sent.length;});};
const selectTone=async program=>{const edited=await p.evaluate(()=>audit.frame.instrument.edited);await p.getByRole('combobox',{name:'Tone program',exact:true}).selectOption(String(program));if(edited&&await p.locator('.ww-tone-confirm').isVisible())await p.getByRole('button',{name:'Discard and load',exact:true}).click();await p.waitForFunction(program=>audit.frame.programs[audit.frame.track]===program,program);};
try{
  await p.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
  await p.goto('http://localhost:8737/simulator/');await p.locator('[data-workspace="tones"]').click();assert(await editor.getByRole('button',{name:'Save',exact:true}).isDisabled());await start();await selectTone(71);
  assert.equal(await editor.locator('[data-param]').count(),63);assert.equal(await p.evaluate(()=>audit.catalog.length),63);
  await group('Filter');await setNumber(12,40);assert(await p.getByRole('combobox',{name:'Tone program',exact:true}).getAttribute('title').then(t=>t.includes('INIT')));
  await p.waitForFunction(()=>document.querySelector('#ww-tone-detail').textContent.includes('Edited'));
  const knob=editor.locator('[data-param="12"] [role="slider"]');await knob.focus();await p.keyboard.press('ArrowUp');await p.waitForFunction(()=>audit.frame.editor.values[12].value===41);await p.keyboard.press('ArrowDown');await p.waitForFunction(()=>audit.frame.editor.values[12].value===40);
  const box=await knob.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2,box.y+box.height/2-10);await p.mouse.up();await p.waitForFunction(()=>audit.frame.editor.values[12].value>40);await setNumber(12,40);
  await group('Envelopes');await setNumber(27,0);await group('Oscillators');
  const held=60;await send({t:'midi',st:0x90,d1:held,d2:100});await p.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate));
  const mark=await p.evaluate(()=>audit.sent.length);for(const name of ['Filter','Envelopes','Modulation','Voice','Arpeggiator','Shared effects','Oscillators'])await group(name);
  await p.locator('[data-workspace="perf"]').click();await p.locator('[data-workspace="tones"]').click();
  assert(await p.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate)));assert.equal(await p.evaluate(()=>audit.contexts),1);assert.equal(await p.evaluate(mark=>audit.sent.length-mark,mark),0);
  await editor.getByRole('button',{name:'Save as…',exact:true}).click();await dialog.getByRole('textbox',{name:'Tone name',exact:true}).fill('BAD_NAME');assert.equal(await dialog.getByRole('textbox',{name:'Tone name',exact:true}).evaluate(n=>n.checkValidity()),false);await dialog.getByRole('textbox',{name:'Tone name',exact:true}).fill('UX TEST');await dialog.getByRole('combobox',{name:'Destination program',exact:true}).selectOption('99');
  const originalName=await p.evaluate(()=>audit.frame.instrument.name);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await p.evaluate(()=>audit.frame.instrument.name),originalName);assert.equal(await p.evaluate(()=>audit.frame.programs[0]),71);
  await editor.getByRole('button',{name:'Save as…',exact:true}).click();await dialog.getByRole('textbox',{name:'Tone name',exact:true}).fill('UX TEST');await dialog.getByRole('combobox',{name:'Destination program',exact:true}).selectOption('99');await p.screenshot({path:`${root}/save-as.png`});
  await dialog.getByRole('button',{name:'Confirm overwrite',exact:true}).click();await p.waitForFunction(()=>audit.frame.editor.save?.state==='waiting');assert(await p.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate)));
  await send({t:'midi',st:0x80,d1:held,d2:0});await p.waitForFunction(()=>document.querySelector('.ww-tone-editor [role="status"]').textContent.includes('browser storage updated'));
  assert.equal(await p.evaluate(()=>audit.frame.instrument.name),'UX TEST');assert.equal(await p.evaluate(()=>audit.frame.programs[0]),99);assert.equal(await p.evaluate(()=>audit.frame.instrument.edited),false);assert.equal(await p.evaluate(()=>audit.library[98].name),'UX TEST');
  assert.equal(await p.evaluate(()=>localStorage.getItem('waswan-midi-profile-v1')),await p.evaluate(()=>audit.profile));
  // Same-slot Save, guarded stale confirmation, and browser storage failure/recovery.
  await group('Filter');await setNumber(12,43);await editor.getByRole('button',{name:'Save',exact:true}).click();assert(await dialog.getByRole('textbox',{name:'Tone name',exact:true}).getAttribute('readonly')!==null);assert(await dialog.getByRole('combobox',{name:'Destination program',exact:true}).isDisabled());
  await send({t:'editor-set',id:12,value:44,scope:await p.evaluate(()=>audit.frame.instrument.scope)});await p.waitForFunction(()=>audit.frame.editor.values[12].value===44);await dialog.getByRole('button',{name:'Confirm overwrite',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.ww-tone-editor [role="status"]').textContent.includes('not applied'));assert(await p.evaluate(()=>audit.frame.instrument.edited));
  await editor.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByRole('button',{name:'Confirm overwrite',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.ww-tone-editor [role="status"]').textContent.includes('browser storage updated'));
  // Simulate a denied write only in this isolated browser context; preserve/export the engine memory.
  await p.evaluate(()=>{audit.setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='smksynth-1.0.0')throw new DOMException('Test storage denied','QuotaExceededError');return audit.setItem.call(this,key,value);};});
  await setNumber(12,45);await editor.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByRole('button',{name:'Confirm overwrite',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.ww-tone-editor [role="status"]').textContent.includes('browser storage failed'));
  await p.evaluate(()=>{Storage.prototype.setItem=audit.setItem;});await send({t:'flush'});await p.waitForFunction(()=>document.querySelector('.ww-tone-editor [role="status"]').textContent.includes('browser storage updated'));
  await p.waitForFunction(()=>audit.frame.editor.available);await p.screenshot({path:`${root}/editor-desktop.png`,fullPage:true});await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:`${root}/editor-mobile.png`,fullPage:true});await p.setViewportSize({width:1560,height:1100});
  assert(!(await p.evaluate(()=>audit.sent.slice(audit.startMark).some(m=>['panic','reboot'].includes(m.t)))));
  await p.reload();await start();await selectTone(99);assert.equal(await p.evaluate(()=>audit.frame.instrument.name),'UX TEST');assert.equal(await p.evaluate(()=>audit.frame.editor.values[12].value),45);
  // Explicit Legacy-style reboot reuses the shell without duplicating the editor/catalog.
  const epoch=await p.evaluate(()=>audit.frame.ms);await send({t:'reboot'});await p.waitForFunction(epoch=>audit.frame.ms<epoch,epoch);await p.waitForFunction(()=>audit.frame.editor.available);await selectTone(99);
  assert.equal(await editor.locator('[data-param]').count(),63);assert.equal(await editor.locator('.ww-editor-tabs button').count(),7);
  await p.evaluate(()=>{audit.startMark=audit.sent.length;});
  // Part B is independent; shared FX explicitly resolve to part A.
  await send({t:'enc',e:5,steps:1});await p.waitForFunction(()=>audit.frame.track===1&&audit.frame.editor.available);await group('Filter');await setNumber(12,50);assert.equal(await p.evaluate(()=>audit.frame.instrument.controls[0].value),50);
  await group('Shared effects');await setNumber(53,30);assert.equal(await p.evaluate(()=>audit.frame.editor.values[53].value),30);
  await send({t:'drums',part:1,kit:0});await p.waitForFunction(()=>audit.frame.engines[1]===2);assert(await editor.getByText('DRUM-X uses different parameter meanings.',{exact:false}).isVisible());assert(await editor.getByRole('button',{name:'Save',exact:true}).isDisabled());
  assert.equal(await p.evaluate(()=>audit.contexts),1);assert.equal(await p.evaluate(()=>audit.context.state),'running');assert(!(await p.evaluate(()=>audit.sent.slice(audit.startMark).some(m=>['panic','reboot'].includes(m.t)))));assert.deepEqual(errors,[]);
  const report={result:'PASS',chrome:await browser.version(),parameters:63,groups:7,unitKeyboard:true,pointer:true,cancel:true,saveAs:true,overwrite:true,staleGuard:true,browserPersistence:true,deniedStorageRecovery:true,reload:true,explicitRebootCatalog:true,partSync:true,sharedFx:true,drumBlocked:true,heldNotesNavigation:true,sameContext:true,profilePreserved:true,mobileOverflow:false,errors};fs.writeFileSync(`${root}/browser.json`,JSON.stringify(report,null,2));console.log(report);
}catch(error){console.log(await p.evaluate(()=>({commands:audit.sent.filter(m=>m.t==='editor-save'),save:audit.frame?.editor?.save,state:audit.frame?.presetSave,status:document.querySelector('.ww-tone-editor [role="status"]')?.textContent})).catch(()=>null));throw error;}finally{await browser.close();}
