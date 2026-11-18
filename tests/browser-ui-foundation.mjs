// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='.local/validation/ui-foundation';fs.mkdirSync(root,{recursive:true});
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const context=await b.newContext({viewport:{width:1560,height:1100},acceptDownloads:true,hasTouch:true}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{
    window.audit={sent:[],contexts:0,ready:0,frames:0};
    const source={id:'ui-test',name:'Synthetic SMK controls',state:'connected',async open(){},async close(){}};audit.source=source;
    navigator.requestMIDIAccess=async()=>({inputs:new Map([['ui-test',source]])});
    if(!localStorage.getItem('waswan-midi-profile-v1'))localStorage.setItem('waswan-midi-profile-v1',JSON.stringify({version:1,enabled:true,bindings:[{port:source.name,channel:0,cc:48,target:'enc:0',mode:'absolute',behavior:'fine'}]}));
    const AC=AudioContext;window.AudioContext=class extends AC {constructor(o){super(o);audit.contexts++;audit.context=this;}createAnalyser(){const a=super.createAnalyser();audit.analyser=a;return a;}};
    const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN {constructor(...args){super(...args);audit.node=this;const post=this.port.postMessage.bind(this.port);this.port.postMessage=(m,...rest)=>{audit.sent.push(structuredClone(m));post(m,...rest);};this.port.addEventListener('message',e=>{if(e.data.t==='frame'){audit.frame=e.data;audit.frames++;}if(e.data.t==='ready')audit.ready++;if(e.data.t==='error')throw Error(e.data.message);});}};
  });
  const go=async id=>{
    if(id==='diag')await p.getByRole('button',{name:'Settings',exact:true}).click();
    await p.locator(`[data-workspace="${id}"]`).click();
  };
  const value=id=>p.evaluate(id=>audit.frame.instrument.controls[id].value,id);
  const waitValue=(id,v)=>p.waitForFunction(([id,v])=>audit.frame.instrument.controls[id].value===v,[id,v]);
  const cc=(number,v)=>p.evaluate(([number,v])=>audit.source.onmidimessage({data:[0xb0,number,v]}),[number,v]);
  const midi=(st,d1,d2)=>p.evaluate(([st,d1,d2])=>audit.source.onmidimessage({data:[st,d1,d2]}),[st,d1,d2]);
  await p.goto('http://localhost:8737/simulator/');await p.locator('.ww-shell').waitFor();assert.equal(await p.locator('[data-view="perf"]').isVisible(),true);
  await p.getByRole('button',{name:'Start audio',exact:true}).click();await p.waitForFunction(()=>audit.frame?.ms>5000&&audit.frame?.instrument?.controls.length===12);
  await p.getByRole('button',{name:'Use keyboard & pads',exact:true}).click();
  await p.waitForFunction(()=>document.activeElement?.matches('#keys .key'));
  assert.equal(await p.locator('.ww-navigation [data-workspace]').count(),5);
  assert.equal(await p.locator('.ww-performance .ww-midi-badge:visible').count(),0);
  assert.equal(await p.evaluate(()=>audit.frame.polyphony.limit),256);assert.equal(await p.evaluate(()=>audit.context.state),'running');
  await p.locator('.ww-topbar').getByRole('button',{name:'Settings',exact:true}).click();await p.locator('#midiConnect').click();await p.waitForFunction(()=>!!audit.source.onmidimessage);
  await p.getByRole('button',{name:'Close settings',exact:true}).click();
  // Mode change is an explicit musical edit, before playing the held chord.
  await go('diag');await p.locator('.ww-voice-details summary').click();await p.locator('[data-voice-mode="0"]').click();await p.waitForFunction(()=>audit.frame.polyphony.parts[0].mode===0);await go('perf');
  for(const note of [57,60,64,67])await midi(0x90,note,100);await p.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===4);
  await p.waitForFunction(()=>document.querySelector('.ww-chord').textContent==='Am7');
  await p.evaluate(()=>{audit.sent=[];audit.keyNode=document.querySelector('#keys');audit.padNode=document.querySelector('#pads');audit.programs=JSON.stringify(audit.frame.programs);audit.scope=audit.frame.instrument.scope;});
  const startMs=await p.evaluate(()=>audit.frame.ms);
  for(const id of ['seq','studio','tones','daw','diag','perf'])await go(id);
  const perfNav=p.locator('[data-workspace="perf"]');await perfNav.focus();await perfNav.press('ArrowRight');
  assert.equal(await p.locator('[data-view="tones"]').isVisible(),true);
  await p.getByRole('button',{name:'Filter',exact:true}).click();
  assert.equal(await p.locator('.ww-tone-editor [data-param="12"]:visible').count(),1);
  await p.locator('[data-workspace="tones"]').press('Home');assert.equal(await p.locator('[data-view="perf"]').isVisible(),true);
  await p.getByRole('button',{name:'Instrument setup',exact:true}).click();assert(await p.locator('.ww-instrument-setup').isVisible());assert.equal(await p.locator('.instrument').count(),0);await go('perf');
  const continuity=await p.evaluate(()=>({contexts:audit.contexts,ready:audit.ready,gates:audit.frame.polyphony.slots.filter(v=>v.gate).length,commands:audit.sent,programsSame:JSON.stringify(audit.frame.programs)===audit.programs,scopeSame:audit.frame.instrument.scope===audit.scope,ms:audit.frame.ms,sameNodes:audit.keyNode===document.querySelector('#keys')&&audit.padNode===document.querySelector('#pads')}));
  assert.equal(continuity.contexts,1);assert.equal(continuity.ready,1);assert.equal(continuity.gates,4);assert.deepEqual(continuity.commands,[]);assert(continuity.programsSame&&continuity.scopeSame&&continuity.sameNodes&&continuity.ms>startMs);
  const audible=await p.evaluate(()=>{const a=new Float32Array(audit.analyser.fftSize);audit.analyser.getFloatTimeDomainData(a);return Math.max(...a.map(Math.abs));});assert(audible>0,'real audio continues after all navigation');
  await p.getByRole('button',{name:'Mute output',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.ww-play-actions button[aria-pressed="true"]')?.textContent==='Muted · unmute');await p.waitForTimeout(200);
  assert.equal(await p.evaluate(()=>{const a=new Float32Array(audit.analyser.fftSize);audit.analyser.getFloatTimeDomainData(a);return a.every(v=>Math.abs(v)<1e-5);}),true);
  await p.getByRole('button',{name:'Muted · unmute',exact:true}).click();await p.waitForTimeout(150);
  await p.evaluate(()=>audit.context.suspend());await p.getByRole('button',{name:'Resume audio',exact:true}).click();await p.waitForFunction(()=>audit.context.state==='running'&&audit.frame.polyphony.slots.filter(v=>v.gate).length===4);assert.equal(await p.evaluate(()=>audit.contexts),1);await p.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
  for(const note of [57,60,64,67])await midi(0x80,note,0);
  const knob=p.locator('[data-control="cutoff"] [role="slider"]');let before=await value(0);await knob.press('ArrowUp');await waitValue(0,Math.min(before+1,127));await knob.press('Home');await waitValue(0,0);await knob.press('End');await waitValue(0,127);await knob.press('ArrowDown');await waitValue(0,126);
  const box=await knob.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2,box.y+box.height/2+30,{steps:10});await p.mouse.up();await p.waitForFunction(()=>audit.frame.instrument.controls[0].value<126);
  const touch=await context.newCDPSession(p);await knob.scrollIntoViewIfNeeded();const touchBox=await knob.boundingBox(),touchBefore=await value(0),tx=touchBox.x+touchBox.width/2,ty=touchBox.y+touchBox.height/2;
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty-15}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForFunction(v=>audit.frame.instrument.controls[0].value>v,touchBefore);await touch.detach();
  const fader=p.locator('[data-control="level-a"] input');await fader.press('Home');await waitValue(8,0);await fader.press('ArrowUp');await waitValue(8,1);await fader.press('End');await waitValue(8,127);
  // Per-control learn delegates to the same profile. It does not replace unrelated legacy mappings.
  const mapping=p.getByRole('button',{name:'MIDI assignments',exact:true});
  await mapping.click();assert.equal(await p.locator('.ww-performance .ww-midi-badge:visible').count(),12);
  await p.locator('[data-control="cutoff"] .ww-midi-badge').click();await p.getByRole('button',{name:'Learn control',exact:true}).click();const learnStart=await value(0);await cc(21,53);assert.equal(await value(0),learnStart);await p.getByRole('button',{name:'Close',exact:true}).click();
  await mapping.click();await p.locator('#ww-pickup-cutoff:visible').waitFor();assert.match(await p.locator('#ww-pickup-cutoff').textContent(),/Pickup · move through CC/);
  const bindings=await p.evaluate(()=>JSON.parse(localStorage.getItem('waswan-midi-profile-v1')).bindings);assert.equal(bindings.length,2);assert(bindings.some(x=>x.target==='enc:0'&&x.cc===48));assert(bindings.some(x=>x.target==='control:cutoff'&&x.cc===21));
  await cc(21,learnStart);await p.waitForFunction(()=>audit.frame.instrument.controls[0].picked);await p.locator('#ww-pickup-cutoff').waitFor({state:'hidden'});await cc(21,40);await waitValue(0,40);await cc(21,41);await waitValue(0,41);await cc(21,127);await waitValue(0,127);await cc(21,0);await waitValue(0,0);
  await go('tones');await cc(21,50);await waitValue(0,50);await go('perf');
  // Keyboard pointer and key-up keep the existing handlers; no duplicate note path.
  await p.locator('#keys [data-key="0"]').press('Enter',{delay:100});await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate));
  await p.locator('#pads [data-pad="0"]').press('Enter',{delay:100});
  // Sustain, pitch bend, profile persistence and reload.
  await midi(0xe0,0,80);await midi(0xb0,64,127);await midi(0x90,60,100);await midi(0x80,60,0);await p.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate));await midi(0xb0,64,0);await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate));
  await go('diag');await p.locator('[data-dsp-toggle]').click();await p.locator('[data-dsp-start]').click();await p.waitForTimeout(2300);await p.locator('[data-dsp-stop]').click();await p.waitForFunction(()=>!document.querySelector('[data-dsp-export]').disabled);
  const downloadPromise=p.waitForEvent('download');await p.locator('[data-dsp-export]').click();const dl=await downloadPromise;await dl.saveAs(`${root}/browser-dsp.jsonl`);const records=fs.readFileSync(`${root}/browser-dsp.jsonl`,'utf8').trim().split('\n').map(JSON.parse);assert.equal(records[0].type,'start');assert.equal(records.at(-1).type,'summary');assert(records.some(r=>r.type==='window'));
  await go('perf');
  for(const note of [57,60,64,67])await midi(0x90,note,100);await p.waitForFunction(()=>document.querySelector('.ww-chord').textContent==='Am7');await p.waitForTimeout(150);
  await p.setViewportSize({width:1560,height:1100});await p.screenshot({path:`${root}/performance-desktop.png`,fullPage:true});
  await go('tones');await p.screenshot({path:`${root}/tone-editor.png`,fullPage:true});await go('seq');await p.screenshot({path:`${root}/sequencer.png`,fullPage:true});await go('perf');await p.getByRole('button',{name:'Instrument setup',exact:true}).click();await p.screenshot({path:`${root}/instrument-setup.png`,fullPage:true});await go('perf');
  const layouts=[];
  for(const [width,height] of [[1920,937],[1536,750]]){
    await p.setViewportSize({width,height});
    await p.evaluate(()=>window.scrollTo(0,0));
    const keys=await p.locator('#keys').boundingBox();
    assert(keys.y>=0&&keys.y+keys.height<=height,`keyboard ${keys.y}–${keys.y+keys.height} fits the ${width}×${height} viewport`);
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    layouts.push({width,height,keyboardTop:keys.y,keyboardBottom:keys.y+keys.height});
    await p.screenshot({path:`${root}/performance-${width}x${height}.png`});
  }
  await p.setViewportSize({width:390,height:844});await p.screenshot({path:`${root}/performance-mobile.png`,fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  for(const note of [57,60,64,67])await midi(0x80,note,0);await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate));
  // Save and session round-trip use the existing firmware/storage flow, isolated from the user's browser.
  await p.setViewportSize({width:1560,height:1100});await go('tones');
  const writes=await p.evaluate(()=>audit.frame.writes[1]);await p.locator('.ww-tone-editor').getByRole('button',{name:'Save',exact:true}).click();
  await p.locator('.ww-editor-save').getByRole('button',{name:'Confirm overwrite'}).click();
  await p.waitForFunction(w=>audit.frame.writes[1]>w&&!audit.frame.manualPending,writes);await p.waitForTimeout(1100);
  const savedCutoff=await value(0);await go('perf');await p.locator('.ww-topbar').getByRole('button',{name:'Settings',exact:true}).click();
  await p.locator('.lab summary').click();const exportPromise=p.waitForEvent('download');await p.locator('#export').click();const sessionDownload=await exportPromise;await sessionDownload.saveAs(`${root}/session-roundtrip.json`);
  const sessionBytes=fs.readFileSync(`${root}/session-roundtrip.json`),session=JSON.parse(sessionBytes);assert.equal(session.format,'obervave-voice-lab-1');assert.equal(Buffer.from(session.storage,'base64').length,21*16384);
  p.once('dialog',dialog=>dialog.accept());await Promise.all([p.waitForEvent('load'),p.locator('#import').setInputFiles({name:'session.json',mimeType:'application/json',buffer:sessionBytes})]);
  assert.equal(await p.evaluate(()=>localStorage.getItem('smksynth-1.0.0')),session.storage);await p.reload();await p.locator('.ww-shell').waitFor();assert.equal(await p.locator('[data-view="perf"]').isVisible(),true);const restored=await p.evaluate(()=>JSON.parse(localStorage.getItem('waswan-midi-profile-v1')).bindings);assert.deepEqual(restored,bindings);
  await p.getByRole('button',{name:'Start audio',exact:true}).click();await p.waitForFunction(()=>audit.frame?.instrument&&audit.frame.ms>5000);assert.equal(await p.evaluate(()=>audit.contexts),1);
  await p.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
  // Boot can restore the current pattern's sound set. Explicitly recall the saved program to verify its contents.
  const program=await p.evaluate(()=>audit.frame.programs[0]);
  await p.evaluate(()=>audit.node.port.postMessage({t:'enc',e:6,steps:1}));await p.waitForFunction(n=>audit.frame.programs[0]!==n,program);
  await p.evaluate(()=>audit.node.port.postMessage({t:'enc',e:6,steps:-1}));await p.waitForFunction(n=>audit.frame.programs[0]===n,program);await waitValue(0,savedCutoff);assert.equal(await p.evaluate(()=>audit.frame.instrument.edited),false);assert.deepEqual(errors,[]);
  const report={result:'PASS',chrome:await b.version(),continuity,audioPeakAfterNavigation:audible,controls:'keyboard, pointer drag, touch drag, fader, semantic MIDI learn and pickup',profilePreserved:true,mute:true,resumeWithoutRestart:true,reload:true,presetSave:true,sessionExportImport:true,dspExport:records.length,mobileOverflow:false,layouts,errors,screenshots:7};
  fs.writeFileSync(`${root}/browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await b.close();}
