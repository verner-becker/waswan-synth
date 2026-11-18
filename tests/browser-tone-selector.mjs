// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root='.local/validation/tone-selector-v1';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),context=await browser.newContext({viewport:{width:1560,height:1100}}),p=await context.newPage(),errors=[];
p.setDefaultTimeout(20000);
p.on('pageerror',e=>errors.push(e.message));
await p.addInitScript(()=>{
  window.audit={contexts:0,sent:[],frames:[]};const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;audit.contexts++;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);audit.node=this;const send=this.port.postMessage.bind(this.port);this.port.postMessage=m=>{audit.sent.push(structuredClone(m));send(m);};this.port.addEventListener('message',e=>{if(e.data.t==='frame'){audit.frame=e.data;if(e.data.programLibrary)audit.library=e.data.programLibrary;}});}};
  audit.profile=JSON.stringify({version:1,enabled:true,bindings:[{port:'Synthetic MIDI',channel:0,cc:48,target:'enc:0',mode:'absolute',behavior:'fine'}]});localStorage.setItem('waswan-midi-profile-v1',audit.profile);
});
const send=m=>p.evaluate(m=>audit.node.port.postMessage(m),m),tone=p.getByRole('combobox',{name:'Tone program',exact:true});
const waitProgram=(part,program)=>p.waitForFunction(([part,program])=>audit.frame.track===part&&audit.frame.programs[part]===program&&document.querySelector('.ww-tone-selector').value===String(program),[part,program]);
const start=async()=>{await p.getByRole('button',{name:'Start audio',exact:true}).click();await p.locator('.ww-midi-setup[open]').waitFor();await p.locator('.ww-midi-setup').locator('.ww-midi-continue').click();await p.waitForFunction(()=>audit.frame?.ms>5000);};
const dialog=p.locator('.ww-tone-confirm');
const choose=async(program,consent=true)=>{const edited=await p.evaluate(()=>audit.frame.instrument.edited);await tone.selectOption(String(program));if(edited){await dialog.waitFor({state:'visible'});await dialog.getByRole('button',{name:consent?'Discard and load':'Cancel',exact:true}).click();}};
try{
  await p.goto('http://localhost:8737/simulator/');assert(await tone.isDisabled());await start();
  assert.equal(await tone.locator('option').count(),99);const library=await p.evaluate(()=>audit.library);assert(library.every((x,i)=>x.number===i+1&&typeof x.name==='string'));
  console.log('PASS catalog');
  const originalPrograms=await p.evaluate(()=>audit.frame.programs);
  for(let part=0;part<4;part++){
    if(part){await p.locator('.ww-legacy-toggle').click();await send({t:'enc',e:5,steps:1});await p.waitForFunction(part=>audit.frame.track===part,part);await p.locator('.ww-legacy-toggle').click();}
    await choose(part+1);await waitProgram(part,part+1);const f=await p.evaluate(()=>audit.frame);
    assert.equal(f.instrument.edited,false);assert((await p.locator('.ww-preset').textContent()).includes(`Program ${part+1}`));assert.equal(f.instrument.name,library[part].name);
    for(let other=part+1;other<4;other++)assert.equal(f.programs[other],originalPrograms[other]);
    assert.equal(await p.locator('[data-control="cutoff"] [role="slider"]').getAttribute('aria-valuenow'),String(f.instrument.controls[0].value));
  }
  console.log('PASS four parts');
  // Edit the selected part; cancel leaves all live parameters and command history intact.
  await send({t:'ui-control',source:'ui',id:0,value:40,scope:await p.evaluate(()=>audit.frame.instrument.scope)});await p.waitForFunction(()=>audit.frame.instrument.edited&&audit.frame.instrument.controls[0].value===40);
  const before=await p.evaluate(()=>({programs:audit.frame.programs,controls:audit.frame.instrument.controls,sent:audit.sent.length}));
  await tone.selectOption('5');await dialog.waitFor({state:'visible'});assert((await dialog.textContent()).includes('Part D'));await p.screenshot({path:`${root}/edited-confirmation.png`});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(await p.evaluate(()=>audit.frame.programs),before.programs);assert.equal(await p.evaluate(()=>audit.frame.instrument.controls[0].value),40);assert.equal(await p.evaluate(()=>audit.sent.length),before.sent);assert.equal(await tone.inputValue(),'4');
  await tone.selectOption('5');await dialog.waitFor({state:'visible'});await p.keyboard.press('Escape');assert.equal(await tone.inputValue(),'4');
  await choose(5);await waitProgram(3,5);await p.waitForFunction(()=>!audit.frame.instrument.edited);assert(!(await p.locator('#ww-tone-detail').textContent()).includes('Edited'));
  console.log('PASS discard and cancel');
  // Clean selection never asks for confirmation. Legacy PRESETS and part navigation synchronize.
  await tone.selectOption('6');await waitProgram(3,6);assert(!(await dialog.isVisible()));
  await p.locator('.ww-legacy-toggle').click();await send({t:'enc',e:6,steps:1});await waitProgram(3,7);await send({t:'enc',e:5,steps:-1});await waitProgram(2,3);await p.locator('.ww-legacy-toggle').click();
  console.log('PASS Legacy sync');
  // A note held across tone changes is handled by the original loader; no panic or new context.
  await send({t:'midi',st:0x90,d1:60,d2:100});await p.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate));
  const mark=await p.evaluate(()=>audit.sent.length);await choose(8);await waitProgram(2,8);assert(await p.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate)));await send({t:'midi',st:0x80,d1:60,d2:0});await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate));
  assert.equal(await p.evaluate(()=>audit.contexts),1);assert.equal(await p.evaluate(()=>audit.context.state),'running');assert(!(await p.evaluate(mark=>audit.sent.slice(mark).some(m=>m.t==='panic'||m.t==='voice-mode'||m.t==='reboot'),mark)));
  assert.equal(await p.evaluate(()=>localStorage.getItem('waswan-midi-profile-v1')),await p.evaluate(()=>audit.profile));
  await p.screenshot({path:`${root}/selector-desktop.png`,fullPage:true});
  await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await tone.focus();await p.keyboard.press('Home');await p.keyboard.press('Enter');await waitProgram(2,1);await p.screenshot({path:`${root}/selector-mobile.png`,fullPage:false});
  // Existing session export/import restores the real pattern/program state, not a UI copy.
  await p.setViewportSize({width:1560,height:1100});await p.locator('.ww-topbar').getByRole('button',{name:'Settings',exact:true}).click();await p.locator('.lab summary').click();
  const exportWait=p.waitForEvent('download');await p.locator('#export').click();const download=await exportWait;await download.saveAs(`${root}/session.json`);const bytes=fs.readFileSync(`${root}/session.json`),session=JSON.parse(bytes);assert.equal(session.format,'obervave-voice-lab-1');assert.equal(Buffer.from(session.storage,'base64').length,21*16384);
  p.once('dialog',d=>d.accept());await Promise.all([p.waitForEvent('load'),p.locator('#import').setInputFiles({name:'session.json',mimeType:'application/json',buffer:bytes})]);await start();
  assert.equal(await tone.inputValue(),String(await p.evaluate(()=>audit.frame.programs[audit.frame.track])));assert.equal(await tone.locator('option').count(),99);assert.equal(await p.evaluate(()=>audit.contexts),1);
  assert.deepEqual(errors,[]);fs.writeFileSync(`${root}/browser.json`,JSON.stringify({result:'PASS',chrome:await browser.version(),programs:99,parts:4,cancel:true,confirm:true,legacySync:true,keyboard:true,sameAudioContext:true,heldNotes:true,sessionImport:true,profilePreserved:true,mobileOverflow:false,errors},null,2));console.log('PASS tone selector browser');
}catch(error){console.log('LAST',await p.evaluate(()=>({frame:window.audit?.frame,modal:document.querySelector('.ww-tone-confirm')?.open})).then(x=>({track:x.frame?.track,programs:x.frame?.programs,edited:x.frame?.instrument?.edited,selection:x.frame?.programSelection,modal:x.modal})).catch(()=>null));throw error;}finally{await browser.close();}
