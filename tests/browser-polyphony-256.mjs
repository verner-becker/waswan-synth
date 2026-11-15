// SPDX-License-Identifier: GPL-3.0-only
// Isolated browser test: original MIDI channel routing, no physical MIDI device.
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1150}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.audit={errors:[]};
  const fake={id:'test',name:'SMK-37 Pro-Master (teste)',state:'connected',async open(){},async close(){}};
  audit.input=fake;
  navigator.requestMIDIAccess=async options=>{
   if(options.sysex!==false)throw Error('Unexpected SysEx');
   return {inputs:new Map([['test',fake]])};
  };
  const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...a){super(...a);audit.node=this;this.port.addEventListener('message',e=>{if(e.data.t==='frame')audit.frame=e.data;if(e.data.t==='error')audit.errors.push(e.data.message);});}};
 });
 await page.goto('http://localhost:8737/simulator/');await page.locator('#power').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('áudio ativo'));
 await page.waitForTimeout(5200);
 assert.equal(await page.locator('[data-voice-mode="3"]').getAttribute('aria-pressed'),'true');
 await page.locator('#midiConnect').click();
 await page.waitForFunction(()=>document.querySelector('#midiStatus').textContent.includes('conectada:'));
 await page.locator('.waswan-profile summary').click();await page.locator('[data-enabled]').check();
 await page.locator('[data-target]').selectOption('enc:0');await page.locator('[data-learn]').click();
 const inject=async data=>page.evaluate(data=>audit.input.onmidimessage({data:new Uint8Array(data)}),data);
 const send=async m=>page.evaluate(m=>audit.node.port.postMessage(m),m);
 await inject([0xb5,48,30]);await inject([0xb5,48,31]);
 assert.equal(await page.locator('.waswan-profile tbody tr').count(),1);
 await page.locator('[data-voice-mode="0"]').click();
 await page.waitForFunction(()=>audit.frame.polyphony.parts[0].mode===0);
 assert.equal(await page.evaluate(()=>audit.frame.polyphony.limit),256);
 // Configure the original GLOBAL MIDI CH to 1; channel 2 addresses B independently.
 await send({t:'btn',b:10,down:true});await page.waitForTimeout(80);
 await send({t:'btn',b:10,down:false});await page.waitForTimeout(150);
 await send({t:'enc',e:2,steps:1});await page.waitForTimeout(100);
 // Local engine input loads the same INIT saw on B; no MIDI output is opened.
 await send({t:'midi',st:0xc1,d1:70,d2:0});await page.waitForTimeout(300);
 await send({t:'voice-mode',part:1,mode:0});
 await page.waitForFunction(()=>audit.frame.polyphony.parts[1].mode===0&&audit.frame.programs[1]===71);
 for(const ch of [0,1])for(let n=0;n<128;n++)await inject([0x90+ch,n,100]);
 await page.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===256);
 for(const part of [0,1])assert.equal(await page.evaluate(p=>audit.frame.polyphony.slots.filter(v=>v.gate&&v.part===p).length,part),128);
 assert.equal(await page.locator('.voice-slot[data-state="held"]').count(),256);
 assert.equal(await page.locator('[data-voice-free]').textContent(),'Disponíveis: 0');
 await page.evaluate(()=>{const a=audit.context.createAnalyser();audit.node.connect(a);audit.analyser=a;});
 const simulatedBefore=await page.evaluate(()=>audit.frame.ms);
 await page.waitForTimeout(5000);
 const simulatedElapsed=await page.evaluate(before=>audit.frame.ms-before,simulatedBefore);
 assert(simulatedElapsed>4500,'256 voices must sustain AudioWorklet progress in real time');
 const audio=await page.evaluate(()=>{const data=new Float32Array(2048);audit.analyser.getFloatTimeDomainData(data);return {state:audit.context.state,rate:audit.context.sampleRate,peak:Math.max(...data.map(Math.abs)),rms:Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length),finite:Array.from(data).every(Number.isFinite)};});
 assert(audio.peak>0&&audio.peak<1);assert(audio.finite);assert(audio.rms>0);
 await page.screenshot({path:'.local/validation/polyphony-256-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'.local/validation/polyphony-256-mobile.png',fullPage:true});
 const width=await page.locator('.waswan-polyphony').evaluate(e=>({panel:e.getBoundingClientRect().width,viewport:innerWidth}));assert(width.panel<=width.viewport);
 await page.setViewportSize({width:1440,height:1150});
 // Direct channel B adds the 257th allocation without releasing a panel-owned key first.
 await inject([0x91,64,100]);
 await page.waitForFunction(()=>{
  const g=audit.frame.polyphony.slots.filter(v=>v.gate);
  return g.length===256&&!g.some(v=>v.part===0&&v.note===0)&&g.filter(v=>v.part===1&&v.note===64).length===2;
 });
 await inject([0x80,0,0]);await page.waitForTimeout(100);
 assert.equal(await page.locator('.voice-slot[data-state="held"]').count(),256);
 await inject([0xb0,64,127]);
 for(const ch of [0,1])for(let n=0;n<128;n++)await inject([0x80+ch,n,0]);
 await page.waitForTimeout(100);assert.equal(await page.locator('.voice-slot[data-state="held"]').count(),256);
 assert.equal(await page.locator('[data-sustain]').isChecked(),true);
 await page.locator('[data-sustain]').uncheck();await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
 await page.locator('[data-voice-mode="1"]').click();await send({t:'voice-mode',part:1,mode:1});
 await page.waitForFunction(()=>audit.frame.polyphony.parts.slice(0,2).every(p=>p.mode===1));
 for(let n=0;n<128;n++)await inject([0x90,n,100]);
 await page.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===256);
 await inject([0x91,0,100]);
 await page.waitForFunction(()=>{
  const g=audit.frame.polyphony.slots.filter(v=>v.gate);
  return g.length===256&&!g.some(v=>v.part===0&&v.note===0)&&g.filter(v=>v.part===1&&v.note===0).length===2;
 });
 await inject([0x80,0,0]);await page.waitForTimeout(100);
 assert.equal(await page.locator('.voice-slot[data-state="held"]').count(),256);
 await page.locator('#panic').click();await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
 await page.locator('[data-voice-mode="3"]').click();for(let n=0;n<128;n++)await inject([0x90,n,100]);
 await page.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===1);
 await page.locator('[data-voice-mode="2"]').click();await page.locator('[data-unison]').selectOption('8');
 await inject([0x90,60,100]);await page.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===8);
 await page.locator('[data-voice-mode="0"]').click();await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
 assert.equal(await page.locator('.waswan-profile tbody tr').count(),1);
 errors.push(...await page.evaluate(()=>audit.errors));assert.deepEqual(errors,[]);
 const report={result:'PASS',input:'synthetic MIDI source; original channel routing',voices:256,polyParts:[128,128],dualPitches:128,stealing:true,staleNoteOff:true,sustain:true,release:true,mono:true,unison8:true,mappingsPreserved:true,simulatedElapsedMs:simulatedElapsed,wallWaitMs:5000,audio,errors,width};
 fs.writeFileSync('.local/validation/polyphony-256-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}
