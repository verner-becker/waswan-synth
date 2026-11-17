// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {RATE,readProject} from '../web/studio-format.js';
const root='.local/validation/studio-wave-1';fs.mkdirSync(root,{recursive:true});
const seconds=Number(process.env.STUDIO_RECORD_SECONDS||5);assert(Number.isFinite(seconds)&&seconds>=5&&seconds<=1200);
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.audit={contexts:0,sent:[]};
    audit.source={id:'studio',name:'Studio synthetic input',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([['studio',audit.source]])});
    const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;audit.contexts++;}};
    const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);if(args[1]!=='obervave-smk37')return;audit.node=this;
      const send=this.port.postMessage.bind(this.port);this.port.postMessage=(m,...rest)=>{audit.sent.push({t:m.t,st:m.st,d1:m.d1,d2:m.d2});send(m,...rest);};
      this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});
    }};
    const W=Worker;window.Worker=class extends W{constructor(...args){super(...args);if(String(args[0]).includes('studio-worker'))audit.worker=this;}};
  });
  const button=name=>page.getByRole('button',{name,exact:true}),status=page.locator('.ww-studio-status');
  const state=name=>page.waitForFunction(name=>document.querySelector('.ww-studio-status')?.dataset.state===name,name);
  const start=async()=>{await button('Start audio').click();await page.waitForFunction(()=>audit.frame?.ms>5000);await button('Connect MIDI keyboard').click();await page.waitForFunction(()=>!!audit.source.onmidimessage);await page.locator('.ww-midi-setup').getByRole('button',{name:'OK',exact:true}).click();};
  const midi=(st,d1,d2)=>page.evaluate(([st,d1,d2])=>audit.source.onmidimessage({data:[st,d1,d2],timeStamp:performance.now()}),[st,d1,d2]);
  const download=async(name,path)=>{const wait=page.waitForEvent('download');await button(name).click();const file=await wait;await file.saveAs(path);return fs.readFileSync(path);};
  await page.goto('http://localhost:8737/simulator/');await start();
  await page.evaluate(()=>{audit.node.port.postMessage({t:'voice-mode',part:0,mode:0});audit.node.port.postMessage({t:'ui-control',id:0,value:40,source:'ui',scope:audit.frame.instrument.scope});});
  await page.waitForFunction(()=>audit.frame.instrument.controls[0].value===40);
  await page.locator('[data-workspace="studio"]').click();await button('Record take').click();await state('recording');
  assert(await button('Record take').isDisabled());assert(await button('Save project').isDisabled());
  for(const note of [48,52,55,60])await midi(0x90,note,100);await midi(0xb0,64,127);await midi(0xe0,0,80);
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate));
  // Workspace changes are presentation only, including a held recorded note.
  await page.locator('[data-workspace="perf"]').click();await page.locator('[data-workspace="studio"]').click();
  assert.equal(await page.evaluate(()=>audit.contexts),1);assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate)));
  await button('Mute output').click();await page.waitForTimeout(400);await button('Muted · unmute').click();
  const started=Date.now(),memory=[],cdp=await context.newCDPSession(page);
  while(Date.now()-started<seconds*1000){
    await page.waitForTimeout(Math.min(30000,seconds*1000-(Date.now()-started)));
    await cdp.send('HeapProfiler.collectGarbage');memory.push({wallMs:Date.now()-started,...await cdp.send('Runtime.getHeapUsage')});
    const current=await status.getAttribute('data-state');
    assert(current==='recording'||seconds===1200&&current==='ready'&&Date.now()-started>1190000,await status.textContent());
    if(current==='recording')await midi(0xe0,0,memory.length%2?80:64);
    console.log(JSON.stringify({status:'recording',wallSeconds:Math.round((Date.now()-started)/1000),counter:await page.locator('.ww-studio-counter').textContent()}));
  }
  const sent=await page.evaluate(()=>audit.sent.length);if(await button('Stop recording').isEnabled())await button('Stop recording').click();await state('ready');
  assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate)),'stopping capture must not release notes');
  assert(!(await page.evaluate(n=>audit.sent.slice(n),sent)).some(m=>['panic','reboot','voice-sustain'].includes(m.t)));
  for(const note of [48,52,55,60])await midi(0x80,note,0);await midi(0xb0,64,0);await midi(0xe0,0,64);
  const wav=await download('Export WAV',`${root}/take.wav`),projectBytes=await download('Save project',`${root}/project.wsproj`);
  const take=await readProject(new Blob([projectBytes]));assert.equal(take.project.status,'complete');
  assert.equal(take.project.context.parts[0].parameters[12],40,'unsaved live cutoff retained');
  assert.equal(wav.length,44+take.project.frames*4);assert.equal(wav.toString('ascii',0,4),'RIFF');
  assert(memory.at(-1).usedSize-memory[0].usedSize<8*1024*1024,'main retained JS heap grew excessively');
  assert.deepEqual(Buffer.from(await take.audio.arrayBuffer()),wav);
  assert(wav.subarray(44).some(v=>v!==0),'recorded PCM is nonzero');
  assert(take.project.events.some(e=>e.kind==='input'&&e.data[0]===0x90));assert(take.project.events.some(e=>e.kind==='command'&&e.command.t==='midi'));
  const noteInput=take.project.events.find(e=>e.kind==='input'&&e.data[0]===0x90),noteCommand=take.project.events.find(e=>e.kind==='command'&&e.command.st===0x90);
  const eventTiming={inputFrame:noteInput.frame,engineReceiptFrame:noteCommand.frame,differenceMs:(noteCommand.frame-noteInput.frame)*1000/RATE};
  await button('Listen to take').click();await page.waitForTimeout(300);assert(await button('Stop take playback').isEnabled());await button('Stop take playback').click();
  await page.screenshot({path:`${root}/studio-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${root}/studio-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:1100});
  // Corrupt imports preserve the current take and cannot execute anything.
  await page.getByLabel('Open Studio project').setInputFiles({name:'bad.wsproj',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});
  await page.waitForFunction(()=>document.querySelector('.ww-studio-status').textContent.includes('Project file size'));
  assert(await button('Export WAV').isEnabled());
  await page.reload();await page.locator('[data-workspace="studio"]').click();await button('Recover local take').click();await state('ready');
  const recoveredBytes=await download('Save project',`${root}/recovered.wsproj`);const recovered=await readProject(new Blob([recoveredBytes]));assert.deepEqual(recovered.project,take.project);
  await page.getByLabel('Open Studio project').setInputFiles(`${root}/project.wsproj`);await page.waitForFunction(()=>document.querySelector('.ww-studio-status').textContent.includes('Project opened'));
  assert.equal(await page.evaluate(()=>audit.contexts),0,'opening project does not start the synth');
  // Abrupt worker interruption leaves a marked, recoverable partial take.
  await start();await page.locator('[data-workspace="studio"]').click();await button('Record take').click();await state('recording');await midi(0x90,64,100);await page.waitForTimeout(2400);
  await page.evaluate(()=>audit.worker.terminate());await page.reload();await page.locator('[data-workspace="studio"]').click();await button('Recover local take').click();await state('ready');
  assert((await status.textContent()).includes('incomplete'));
  const partial=await readProject(new Blob([await download('Save project',`${root}/partial.wsproj`)]));assert.equal(partial.project.status,'incomplete');assert(partial.project.frames>RATE);
  // Stop during asynchronous preparation must cancel rather than start a hidden capture.
  await start();await page.locator('[data-workspace="studio"]').click();
  await page.evaluate(async()=>{
    const find=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name);
    find('Record take').click();await Promise.resolve();find('Stop recording').click();
  });
  await state('idle');await page.waitForTimeout(200);assert.equal(await status.getAttribute('data-state'),'idle');
  assert.equal(await page.evaluate(()=>audit.contexts),1);
  // Suspending audio ends recording explicitly and preserves a marked partial take.
  await button('Record take').click();await state('recording');await midi(0x90,67,100);await page.waitForTimeout(1600);
  await page.evaluate(()=>audit.context.suspend());
  await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('.ww-studio-status').dataset.state));
  await page.evaluate(()=>audit.context.resume());await button('Recover local take').click();await page.waitForFunction(()=>document.querySelector('.ww-studio-status').textContent.includes('Recovered local take'));await state('ready');
  assert((await status.textContent()).includes('incomplete'));await midi(0x80,67,0);
  assert.deepEqual(errors,[]);
  const report={result:'PASS',chrome:await browser.version(),requestedRecordingSeconds:seconds,frames:take.project.frames,duration:take.project.frames/RATE,events:take.project.events.length,eventTiming,memory,
    wav:true,projectRoundtrip:true,localRecovery:true,interruptedRecovery:true,preparationCancellation:true,suspensionRecovery:true,unsavedToneContext:true,heldNotes:true,sameInstrument:true,playback:true,mobileOverflow:false,physicalValidation:false,errors};
  fs.writeFileSync(`${root}/browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
