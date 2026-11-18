// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {readProject} from '../web/studio-format.js';
const root='.local/validation/studio-wave-2';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{if(d.message().startsWith('Discard the current Studio project'))void d.accept();});
 await page.addInitScript(()=>{
  window.audit={contexts:0,sent:[]};const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;audit.contexts++;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);if(args[1]==='waswan-studio-metronome'){audit.metro=this;audit.metroAnalyser=args[0].createAnalyser();audit.metroAnalyser.fftSize=512;this.connect(audit.metroAnalyser);}if(args[1]!=='obervave-smk37')return;audit.node=this;const send=this.port.postMessage.bind(this.port);this.port.postMessage=(m,...rest)=>{audit.sent.push({t:m.t});send(m,...rest);};this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;if(m.t==='studio-sequence-state')audit.sequence=m;});}};
 });
 const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
 const send=m=>page.evaluate(m=>audit.node.port.postMessage(m),m);
 const download=async(name,path)=>{const wait=page.waitForEvent('download');await button(name).click();await(await wait).saveAs(path);return fs.readFileSync(path);};
 await page.goto('http://localhost:8737/simulator/');await page.locator('.ww-sequence').waitFor({state:'attached'});await page.locator('.ww-sequence > details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));await button('Start audio').click();await page.waitForFunction(()=>audit.frame?.ms>5000);await page.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
 await send({t:'voice-mode',part:0,mode:0});await page.locator('[data-workspace="seq"]').click();
 await field('Sequence BPM').fill('120');await field('Sequence BPM').dispatchEvent('change');
 await field('Length in quarter beats').fill('4');await field('Length in quarter beats').dispatchEvent('change');
 const clickNote=async(note,x)=>{
  await page.locator('.ww-piano-scroll').scrollIntoViewIfNeeded();
  await page.locator('.ww-piano-scroll').evaluate(e=>e.scrollTop=(127-72)*12);
  const point=await page.locator('.ww-piano-roll').evaluate((canvas,[note,x])=>{const b=canvas.getBoundingClientRect();return {x:b.left+x,y:b.top+(127-note)*12+6};},[note,x]);
  await page.mouse.click(point.x,point.y);
  if(await button('Apply note edit').isDisabled()){
   await page.screenshot({path:`${root}/piano-click-failure.png`,fullPage:true});
   throw Error(JSON.stringify({point,status:await page.locator('.ww-sequence-status').textContent(),errors}));
  }
 };
 await clickNote(60,5);await field('Duration in quarter beats').fill('1');await button('Apply note edit').click();
 assert.equal(await field('Sequence notes').locator('option').count(),1);
 await field('Note part').selectOption('1');await clickNote(64,580);await field('Duration in quarter beats').fill('1');await button('Apply note edit').click();
 assert.equal(await field('Sequence notes').locator('option').count(),2);
 // Editing and quantization are explicit, and Undo restores the musical values.
 await field('Start beat').fill('3.1');await field('Duration in quarter beats').fill('.37');await button('Apply note edit').click();
 await button('Quantize to 1/16').click();assert.equal(Number(await field('Start beat').inputValue()),3);await button('Undo').click();assert(Math.abs(Number(await field('Start beat').inputValue())-3.1)<.01);
 await field('Start beat').fill('3');await field('Duration in quarter beats').fill('1');await button('Apply note edit').click();
 await field('Loop').check();await field('Metronome').check();
 // Studio must not release a live note at the same pitch on Stop.
 await send({t:'midi',st:144,d1:60,d2:100});await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced));
 await button('Play').click();await page.waitForFunction(()=>audit.sequence?.playing);
 await page.waitForFunction(()=>{if(!audit.metroAnalyser)return false;const values=new Float32Array(512);audit.metroAnalyser.getFloatTimeDomainData(values);return values.some(v=>Math.abs(v)>.01);});
 await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&v.sequenced&&v.note===60));
 assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===60)));
 const mark=await page.evaluate(()=>audit.sent.length);
 for(const id of ['perf','studio','tones','diag','seq']){
  if(id==='diag')await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator(`[data-workspace="${id}"]`).click();
 }
 assert.deepEqual(await page.evaluate(n=>audit.sent.slice(n),mark),[],'navigation sends no musical commands');
 await page.waitForFunction(()=>audit.sequence?.cycle>=1);await button('Stop').click();await page.waitForFunction(()=>!audit.sequence.playing);
 await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate||!v.sequenced));
 assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===60)));
 await send({t:'midi',st:128,d1:60,d2:0});
 assert.equal(await page.evaluate(()=>audit.contexts),1);
 const midi=await download('Export MIDI',`${root}/sequence.mid`);assert.equal(midi.toString('ascii',0,4),'MThd');
 const projectBytes=await download('Save project',`${root}/sequence.wsproj`),project=await readProject(new Blob([projectBytes]));
 assert.equal(project.project.frames,0);assert.equal(project.project.sequence.notes.length,2);assert.equal(project.project.sequence.bpm,120);
 await button('Delete note').click();assert.equal(await field('Sequence notes').locator('option').count(),1);
 await page.locator('[data-workspace="studio"]').click();await field('Open Studio project').setInputFiles(`${root}/sequence.wsproj`);await page.waitForFunction(()=>document.querySelector('.ww-studio-status').textContent.includes('Project opened'));
 await page.locator('[data-workspace="seq"]').click();await page.waitForFunction(()=>document.querySelector('.ww-note-list').options.length===2);
 await page.screenshot({path:`${root}/sequence-desktop.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${root}/sequence-mobile.png`,fullPage:true});
 assert.deepEqual(errors,[]);const report={result:'PASS',chrome:await browser.version(),notes:2,pianoRoll:true,edit:true,quantizeUndo:true,loop:true,metronome:true,samePitchLiveNotePreserved:true,navigationNoCommands:true,sameContext:true,smf:true,sequenceOnlyProjectRoundtrip:true,mobileOverflow:false,physicalValidation:false,errors};
 fs.writeFileSync(`${root}/browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
