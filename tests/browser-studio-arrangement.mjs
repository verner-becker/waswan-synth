// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Engine} from '../.local/www/simulator/engine.js';
import {emptySequence,PPQ} from '../web/studio-sequence.js';
import {projectBlob,readProject,wavHeader} from '../web/studio-format.js';
const root='.local/validation/studio-wave-3';fs.mkdirSync(root,{recursive:true});
const seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin'),engine=new Engine(fs.readFileSync('.local/build/waswan-256.wasm'),seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));engine.advance(5000);
const x=engine.ex,contextData={version:1,tempo:x.sim_tempo(),master:x.sim_master_current(),session:seed.toString('base64'),selectedPart:0,mixer:Array.from({length:4},(_,p)=>Array.from({length:8},(_,f)=>x.waswan_studio_mix_value(p,f))),parts:Array.from({length:4},(_,p)=>({program:x.sim_program(p)+1,engine:x.sim_engine_patch(p),parameters:Array.from({length:63},(_,i)=>x.sim_param(p,i)),patch:Array.from({length:80},(_,i)=>x.waswan_studio_patch(p,i))}))};
const sequence=emptySequence();sequence.length=PPQ*4;sequence.notes=[{id:'a',part:0,note:60,velocity:100,start:0,duration:PPQ},{id:'b',part:1,note:64,velocity:100,start:PPQ*2,duration:PPQ}];
const fixture=projectBlob({format:'waswan-studio-project',version:1,name:'Arrangement fixture',frames:0,status:'complete',sampleRate:44100,channels:2,context:contextData,sequence,events:[]},new Blob([wavHeader(0)]));
const file=Buffer.from(await fixture.arrayBuffer());
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const browserContext=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1100}}),page=await browserContext.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{if(d.message().startsWith('Discard the current Studio project'))void d.accept();});
 await page.addInitScript(()=>{
  window.audit={contexts:0,sent:[]};audit.source={id:'arrangement',name:'Synthetic arrangement input',state:'connected',async open(){},async close(){}};
  navigator.requestMIDIAccess=async()=>({inputs:new Map([['arrangement',audit.source]])});
  const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;audit.contexts++;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);if(args[1]!=='obervave-smk37')return;audit.node=this;const send=this.port.postMessage.bind(this.port);this.port.postMessage=(m,...rest)=>{audit.sent.push({t:m.t});send(m,...rest);};this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;if(m.t==='studio-sequence-state')audit.sequence=m;});}};
 });
 const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
 const open=async()=>{await page.locator('[data-workspace="studio"]').click();await field('Open Studio project').setInputFiles({name:'fixture.wsproj',mimeType:'application/octet-stream',buffer:file});await page.waitForFunction(()=>document.querySelector('.ww-studio-status').textContent.includes('Project opened'));};
 const midi=(st,d1,d2)=>page.evaluate(([st,d1,d2])=>audit.source.onmidimessage({data:[st,d1,d2],timeStamp:performance.now()}),[st,d1,d2]);
 await page.goto('http://localhost:8737/simulator/');await page.locator('.ww-sequence').waitFor({state:'attached'});await page.locator('.ww-sequence > details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));await open();await page.locator('[data-workspace="seq"]').click();assert.equal(await field('Sequence notes').locator('option').count(),2);assert.equal(await page.evaluate(()=>audit.contexts),0,'project notes load without starting audio');
 await button('Start audio').click();await page.waitForFunction(()=>audit.frame?.ms>5000);await button('Connect MIDI keyboard').click();await page.waitForFunction(()=>!!audit.source.onmidimessage);await page.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
 await button('Make clip A').click();assert.equal(await field('Arrangement clip').locator('option').count(),1);
 await button('Duplicate clip').click();assert.equal(await field('Arrangement clip').locator('option').count(),2);assert.equal(await field('Sequence notes').locator('option').count(),3);
 await field('Clip start beat').fill('9');await field('Clip part').selectOption('2');await button('Move clip').click();
 assert.equal(await field('Clip start beat').inputValue(),'9');assert.equal(await field('Clip part').inputValue(),'2');
 await button('Mute A').click();await button('Solo C').click();await button('Play').click();await page.waitForFunction(()=>audit.sequence?.playing);await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&v.sequenced&&v.part===2));
 assert(await page.evaluate(()=>audit.frame.polyphony.slots.filter(v=>v.gate&&v.sequenced).every(v=>v.part===2)));
 await button('Stop').click();await page.waitForFunction(()=>!audit.sequence.playing);
 await field('Part A volume').press('End');await field('Part A volume').press('ArrowLeft');await page.waitForFunction(()=>audit.frame.studioMixer[0][0]===126);
 await field('Part A pan').press('End');await page.waitForFunction(()=>audit.frame.studioMixer[0][1]===64);
 // Open leaves live edits alone; explicit Apply has cancel/confirm and a token guard.
 await page.evaluate(()=>audit.node.port.postMessage({t:'ui-control',source:'ui',id:0,value:40,scope:audit.frame.instrument.scope}));await page.waitForFunction(()=>audit.frame.instrument.controls[0].value===40);
 await open();assert.equal(await page.evaluate(()=>audit.frame.studioMixer[0][0]),126);
 page.once('dialog',d=>d.dismiss());await button('Apply saved tones and mixer').click();assert.equal(await page.evaluate(()=>audit.frame.instrument.controls[0].value),40);
 page.once('dialog',d=>d.accept());await button('Apply saved tones and mixer').click();
 try{await page.waitForFunction(([value,level])=>audit.frame.instrument.controls[0].value===value&&audit.frame.studioMixer[0][0]===level,[contextData.parts[0].parameters[12],contextData.mixer[0][0]],{timeout:6000});}
 catch(error){console.log('CONTEXT',await page.evaluate(()=>({status:document.querySelector('.ww-studio-status').textContent,cut:audit.frame.instrument.controls[0].value,mixer:audit.frame.studioMixer,playing:audit.frame.instrument.playing})));throw error;}
 assert.equal(await page.evaluate(()=>audit.contexts),1);
 // A fresh overdub adds external notes, rather than replacing accompaniment.
 await page.locator('[data-workspace="seq"]').click();await button('Overdub A').click();
 await page.waitForFunction(()=>document.querySelector('.ww-studio-status').dataset.state==='recording'&&audit.sequence?.playing);
 await midi(144,67,100);await page.waitForTimeout(300);await midi(128,67,0);await page.waitForTimeout(300);
 const mark=await page.evaluate(()=>audit.sent.length);await button('Finish overdub').click();await page.waitForFunction(()=>document.querySelector('.ww-note-list').options.length===3);
 assert(!(await page.evaluate(n=>audit.sent.slice(n),mark)).some(m=>m.t==='panic'||m.t==='reboot'));
 const wait=page.waitForEvent('download');await button('Save project').click();await(await wait).saveAs(`${root}/arrangement.wsproj`);const saved=await readProject(new Blob([fs.readFileSync(`${root}/arrangement.wsproj`)]));assert.equal(saved.project.sequence.notes.length,3);assert(saved.project.sequenceContext.parts.every(p=>p.patch.length===80));
 await page.screenshot({path:`${root}/arrangement-desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${root}/arrangement-mobile.png`,fullPage:true});
 assert.deepEqual(errors,[]);const report={result:'PASS',chrome:await browser.version(),clips:true,duplicate:true,movePart:true,muteSolo:true,partMixer:true,offlineProjectLoad:true,contextCancelConfirm:true,fullToneSnapshot:true,overdub:true,sameContext:true,noPanic:true,mobileOverflow:false,physicalValidation:false,errors};fs.writeFileSync(`${root}/browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
