// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const context=await b.newContext({viewport:{width:1440,height:1100},acceptDownloads:true}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{
  window.audit={errors:[],sent:[]};const fake={id:'fine-test',name:'Synthetic knobs',state:'connected',async open(){},async close(){}};audit.source=fake;
  navigator.requestMIDIAccess=async()=>({inputs:new Map([['fine-test',fake]])});
  // Old profile has no behavior field. Separate browser context protects personal mappings.
  if(!localStorage.getItem('waswan-midi-profile-v1'))localStorage.setItem('waswan-midi-profile-v1',JSON.stringify({version:1,enabled:true,bindings:[{port:fake.name,channel:0,cc:48,target:'enc:0',mode:'absolute'}]}));
  const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...a){super(...a);audit.node=this;this.port.addEventListener('message',e=>{if(e.data.t==='frame')audit.frame=e.data;if(e.data.t==='error')audit.errors.push(e.data.message);});}};
 });
 await p.goto('http://localhost:8737/simulator/');await p.locator('#power').click();await p.waitForFunction(()=>audit.frame?.ms>5000);await p.locator('#midiConnect').click();await p.waitForFunction(()=>document.querySelector('#midiStatus').textContent.includes('conectada:'));await p.locator('.waswan-profile summary').click();
 assert.equal(await p.locator('[data-binding-behavior="enc:0"]').inputValue(),'normal');
 const send=async m=>p.evaluate(m=>audit.node.port.postMessage(m),m),cc=async v=>p.evaluate(v=>audit.source.onmidimessage({data:[0xb0,48,v]}),v);
 const value=async()=>p.evaluate(()=>audit.frame.knobControl.parameters[0]?.value);
 const set40=async()=>{await send({t:'midi',st:0xb0,d1:74,d2:40});await p.waitForFunction(()=>audit.frame.knobControl.parameters[0]?.value===40);};
 await set40();await cc(40);await cc(42);await p.waitForFunction(()=>audit.frame.knobControl.parameters[0].value===52);
 await p.locator('[data-binding-behavior="enc:0"]').selectOption('fine');await set40();await cc(70);await cc(71);await p.waitForTimeout(100);assert.equal(await value(),40);await cc(40);await cc(41);await p.waitForFunction(()=>audit.frame.knobControl.parameters[0].value===41);await cc(43);await p.waitForFunction(()=>audit.frame.knobControl.parameters[0].value===43);
 await cc(40);await p.waitForFunction(()=>audit.frame.knobControl.parameters[0].value===40);
 await p.evaluate(()=>{for(const v of [41,42,43,44,45,46,47,48,49,50])audit.source.onmidimessage({data:[0xb0,48,v]});});await p.waitForFunction(()=>audit.frame.knobControl.parameters[0].value===50);
 // Original PARA page button; first absolute value seeds a new reference.
 const oldContext=await p.evaluate(()=>audit.frame.knobControl.context);
 await send({t:'btn',b:13,down:true});await p.waitForTimeout(80);await send({t:'btn',b:13,down:false});await p.waitForFunction(c=>audit.frame.knobControl.context!==c,oldContext);
 await p.waitForFunction(()=>audit.frame.knobControl.parameters[0]?.value!=null);
 const pageBefore=await value();await cc(10);await p.waitForTimeout(100);assert.equal(await value(),pageBefore);
 // Recall via original preset encoder and reseed even for identical-value recalls.
 const c=await p.evaluate(()=>audit.frame.knobControl.context);await send({t:'enc',e:6,steps:1});await p.waitForFunction(c=>audit.frame.knobControl.context!==c,c);const afterPreset=await value();await cc(110);await p.waitForTimeout(100);assert.equal(await value(),afterPreset);
 // Relearn same source in the two supported relative formats, no guessed hardware mode.
 for(const [format,up,down] of [['offset',65,63],['twos',1,127]]){
  await p.locator('[data-target]').selectOption('enc:0');await p.locator('[data-mode]').selectOption(format);await p.locator('[data-behavior]').selectOption('fine');await p.locator('[data-learn]').click();await cc(format==='offset'?64:0);await p.waitForTimeout(100);
  const before=await value();await cc(up);await p.waitForFunction(before=>audit.frame.knobControl.parameters[0].value===Math.min(before+1,4),before);await cc(down);await p.waitForTimeout(100);
 }
 // Relearn absolute and reconnect: first value does not jump.
 await p.locator('[data-mode]').selectOption('absolute');await p.locator('[data-learn]').click();await cc(30);await p.waitForTimeout(100);
 await p.locator('#midiInput').selectOption('');await p.locator('#midiInput').selectOption('fine-test');await p.waitForTimeout(150);const reconnect=await value();await cc(120);await p.waitForTimeout(150);assert.equal(await value(),reconnect);
 await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await p.waitForTimeout(150);const focused=await value();await cc(10);await p.waitForTimeout(100);assert.equal(await value(),focused);
 // Unmapped note, pitch and sustain keep the original path; panic releases everything.
 await p.evaluate(()=>{for(const data of [[0x90,60,100],[0xe0,0,80],[0xb0,64,127]])audit.source.onmidimessage({data});});await p.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate));await p.locator('#panic').click();await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
 await p.locator('[data-dsp-toggle]').click();await p.locator('[data-dsp-start]').click();await p.waitForTimeout(2200);await p.locator('[data-dsp-stop]').click();await p.waitForFunction(()=>!document.querySelector('[data-dsp-export]').disabled);const dp=p.waitForEvent('download');await p.locator('[data-dsp-export]').click();await(await dp).saveAs('.local/validation/knob-fine-dsp.jsonl');
 const lines=fs.readFileSync('.local/validation/knob-fine-dsp.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.equal(lines.at(-1).type,'summary');assert(lines.at(-1).blocks>0);
 errors.push(...await p.evaluate(()=>audit.errors));
 await p.reload();await p.locator('.waswan-profile summary').click();assert.equal(await p.locator('[data-binding-behavior="enc:0"]').inputValue(),'fine');
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:'.local/validation/knob-fine-mobile.png',fullPage:true});
 errors.push(...await p.evaluate(()=>audit.errors));assert.deepEqual(errors,[]);const report={result:'PASS',legacyMigration:true,normal40plus2:52,fine40plus1:41,finePlus2:43,absolutePickup:true,fastMoves:true,pageReseed:true,presetReseed:true,reconnect:true,focus:true,relativeFormats:['offset','twos'],profilePersists:true,notesPanic:true,dspMonitor:true,errors};fs.writeFileSync('.local/validation/knob-fine-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await b.close();}
