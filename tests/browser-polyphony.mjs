// SPDX-License-Identifier: GPL-3.0-only
// Optional browser regression; install Playwright locally as documented.
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';
const limit=Number(process.argv[2]||64);
assert([8,16,32,64].includes(limit),'Only approved stages can be tested');
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1150}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.audit={};
  const fake={id:'test',name:'SMK-37 Pro-Master (teste)',state:'connected',async open(){},async close(){}};
  audit.input=fake;
  navigator.requestMIDIAccess=async options=>{
   if(options.sysex!==false)throw Error('Unexpected SysEx');
   return {inputs:new Map([['test',fake]])};
  };
  const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...a){super(...a);audit.node=this;this.port.addEventListener('message',e=>{if(e.data.t==='frame')audit.frame=e.data;});}};
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
 await inject([0xb5,48,30]);await inject([0xb5,48,31]);
 assert.equal(await page.locator('.waswan-profile tbody tr').count(),1);
 await page.locator('[data-voice-mode="0"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-voice-mode="0"]').getAttribute('aria-pressed')==='true');
 assert.equal(await page.evaluate(()=>audit.frame.polyphony.limit),limit);
 const notes=Array.from({length:limit},(_,i)=>24+i);
 for(const n of notes)await inject([0x90,n,100]);
 await page.waitForFunction(n=>audit.frame.polyphony.slots.filter(v=>v.gate).length===n,limit);
 assert.equal(await page.locator('.voice-slot[data-state="held"]').count(),limit);
 assert.equal(await page.locator('[data-voice-free]').textContent(),'Disponíveis: 0');
 await page.evaluate(()=>{const a=audit.context.createAnalyser();audit.node.connect(a);audit.analyser=a;});
 const simulatedBefore=await page.evaluate(()=>audit.frame.ms);
 await page.waitForTimeout(3000);
 assert(await page.evaluate(before=>audit.frame.ms>before+2500,simulatedBefore),'AudioWorklet must keep advancing in real time');
 const audio=await page.evaluate(()=>{const data=new Float32Array(2048);audit.analyser.getFloatTimeDomainData(data);return {state:audit.context.state,rate:audit.context.sampleRate,peak:Math.max(...data.map(Math.abs)),rms:Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length),finite:Array.from(data).every(Number.isFinite)};});
 assert(audio.peak>0&&audio.peak<1);assert(audio.finite);assert(audio.rms>0);await page.screenshot({path:`.local/validation/polyphony-${limit}-desktop.png`,fullPage:true});
 const extra=24+limit;
 await inject([0x90,extra,100]);await page.waitForTimeout(60);
 const held=await page.evaluate(()=>audit.frame.polyphony.slots.filter(v=>v.gate).map(v=>v.note));
 assert.equal(held.length,limit);assert(!held.includes(24));assert(held.includes(extra));
 await inject([0xb0,64,127]);for(const n of [...notes,extra])await inject([0x80,n,0]);
 await page.waitForTimeout(100);assert.equal(await page.locator('.voice-slot[data-state="held"]').count(),limit);
 assert.equal(await page.locator('[data-sustain]').isChecked(),true);
 await page.locator('[data-sustain]').uncheck();await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
 for(const [mode,count] of [[3,1],[1,limit],[2,4]]) {
  await page.locator(`[data-voice-mode="${mode}"]`).click();
  await page.waitForFunction(m=>audit.frame.polyphony.parts[0].mode===m,mode);
  for(const n of notes)await inject([0x90,n,100]);
  await page.waitForFunction(c=>audit.frame.polyphony.slots.filter(v=>v.gate).length===c,count);
  await page.locator('#panic').click();await page.waitForTimeout(200);
 }
 await page.locator('[data-unison]').selectOption('8');
 await inject([0x90,60,100]);await page.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===8);
 await page.locator('[data-voice-mode="0"]').click();
 await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
 assert.equal(await page.locator('.waswan-profile tbody tr').count(),1);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:`.local/validation/polyphony-${limit}-mobile.png`,fullPage:true});
 const width=await page.locator('.waswan-polyphony').evaluate(e=>({panel:e.getBoundingClientRect().width,viewport:innerWidth}));
 assert(width.panel<=width.viewport);assert.equal(errors.length,0);
 const report={result:'PASS',input:'synthetic MIDI source',modes:['POLY','MONO','DUAL','UNISON'],chord:limit,stealing:true,sustain:true,release:true,unison8:true,mappingsPreserved:true,audio,errors,width};
 fs.writeFileSync(`.local/validation/polyphony-${limit}-browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}
