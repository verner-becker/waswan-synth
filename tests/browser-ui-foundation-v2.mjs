// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root='.local/validation/ui-foundation-v2';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const results=[],allErrors=[];
async function fixture(scenario='devices') {
  const context=await browser.newContext({viewport:{width:1560,height:1100}}),p=await context.newPage();p.on('pageerror',e=>allErrors.push(e.message));
  await p.addInitScript(scenario=>{
    window.audit={requests:0,contexts:0,ready:0,sent:[],sources:[]};
    const make=id=>({id,name:`Synthetic MIDI ${id}`,state:'connected',async open(){},async close(){}});
    audit.sources=[make('A'),make('B')];audit.scenario=scenario;
    navigator.requestMIDIAccess=async options=>{audit.requests++;if(options.sysex!==false)throw Error('Unexpected SysEx');if(audit.scenario==='denied')throw new DOMException('Denied','NotAllowedError');return {inputs:new Map(audit.scenario==='empty'?[]:audit.sources.map(x=>[x.id,x]))};};
    audit.profile=JSON.stringify({version:1,enabled:true,bindings:[{port:'Synthetic MIDI B',channel:0,cc:48,target:'enc:0',mode:'absolute',behavior:'fine'}]});localStorage.setItem('waswan-midi-profile-v1',audit.profile);
    const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;audit.contexts++;}};
    const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);audit.node=this;const send=this.port.postMessage.bind(this.port);this.port.postMessage=m=>{audit.sent.push(structuredClone(m));send(m);};this.port.addEventListener('message',e=>{if(e.data.t==='frame')audit.frame=e.data;if(e.data.t==='ready')audit.ready++;if(e.data.t==='error')audit.error=e.data.message;});}};
  },scenario);
  await p.goto('http://localhost:8737/simulator/');await p.locator('.ww-shell').waitFor();
  await p.evaluate(()=>{audit.panel=document.querySelector('.midi-panel');audit.input=document.querySelector('#midiInput');});
  return {p,context};
}
const start=async p=>{await p.getByRole('button',{name:'Start audio',exact:true}).click();await p.locator('.ww-midi-setup[open]').waitFor();await p.waitForFunction(()=>audit.frame?.ms>5000);};
const ok=async p=>{await p.locator('.ww-midi-setup').getByRole('button',{name:'OK',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('.ww-midi-setup').open&&document.querySelector('.ww-settings .midi-panel'));};
const go=(p,id)=>p.locator(`[data-workspace="${id}"]`).click();
const mode=(p,id)=>p.locator(`[data-performance-mode="${id}"]`);
const waitMode=(p,part,id)=>p.waitForFunction(([part,id])=>audit.frame.polyphony.parts[part].mode===id&&document.querySelector(`[data-performance-mode="${id}"]`).getAttribute('aria-pressed')==='true',[part,id]);
const virtualKey=async p=>{const key=p.locator('#keys [data-key="0"]');await key.focus();await p.keyboard.down('Enter');await p.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate));await p.keyboard.up('Enter');await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate));};
try {
  const {p,context}=await fixture();
  const beforeDisabled=await p.locator('[data-performance-mode]').evaluateAll(xs=>xs.every(x=>x.disabled));assert(beforeDisabled);
  await start(p);assert.equal(await p.evaluate(()=>audit.requests),0,'opening setup does not request MIDI permission');assert.equal(await p.locator('#midiConnect').count(),1);assert.equal(await p.locator('#midiInput').count(),1);
  await p.getByRole('button',{name:'Connect MIDI keyboard',exact:true}).click();assert.equal(await p.evaluate(()=>audit.requests),1);assert.deepEqual(await p.locator('#midiInput option').evaluateAll(xs=>xs.map(x=>x.value)),['','A','B']);
  await p.locator('#midiInput').selectOption('B');await p.waitForFunction(()=>!!audit.sources[1].onmidimessage);assert((await p.locator('#midiStatus').textContent()).includes('MIDI input connected:'));
  await p.waitForFunction(()=>document.querySelector('.ww-topbar .ww-status').textContent==='MIDI · Connected');await p.screenshot({path:`${root}/midi-setup-desktop.png`});await ok(p);
  await p.locator('.ww-topbar').getByRole('button',{name:'Settings',exact:true}).click();assert.equal(await p.locator('.ww-settings #midiInput').inputValue(),'B');assert(await p.evaluate(()=>audit.panel===document.querySelector('.midi-panel')&&audit.input===document.querySelector('#midiInput')));assert(await p.evaluate(()=>localStorage.getItem('waswan-midi-profile-v1')===audit.profile));await p.getByRole('button',{name:'Close settings',exact:true}).click();
  const originalUnison=await p.evaluate(()=>audit.frame.polyphony.parts[0].unison);
  for(const [id,label] of [[0,'POLY'],[3,'MONO'],[1,'DUAL'],[2,'UNISON']]){
    await mode(p,id).click();await waitMode(p,0,id);assert.equal(await p.locator('.ww-performance-modes [aria-pressed="true"]').count(),1);assert.equal(await p.locator('.ww-topbar .ww-chip').first().textContent(),label);
    assert.equal(await p.locator(`[data-voice-mode="${id}"]`).getAttribute('aria-pressed'),'true');
  }
  assert.equal(await p.evaluate(()=>audit.frame.polyphony.parts[0].unison),originalUnison);assert(!await p.evaluate(()=>audit.sent.some(m=>m.t==='voice-unison')));
  // Real Diagnostics action updates the same snapshot and Performance selection.
  await go(p,'diag');await p.locator('.ww-voice-details summary').click();await p.locator('[data-voice-mode="3"]').click();await waitMode(p,0,3);await go(p,'perf');
  // Change the selected part through the unchanged legacy encoder.
  await p.locator('.ww-legacy-toggle').click();await p.locator('.dial[aria-label="Part"]').press('ArrowUp');await p.waitForFunction(()=>audit.frame.track===1);await p.locator('.ww-legacy-toggle').click();
  await mode(p,1).click();await waitMode(p,1,1);assert.equal(await p.evaluate(()=>audit.frame.polyphony.parts[0].mode),3);
  // Edit the actual native VOICE page, not a mocked snapshot.
  await p.locator('.ww-legacy-toggle').click();for(let i=0;i<2;i++){await p.locator('#buttons [data-button="10"]').press('Enter',{delay:90});await p.waitForTimeout(120);}await p.waitForFunction(()=>audit.frame.knobControl.parameters[0]?.id===38);
  await p.locator('.dial[aria-label="Screen 1"]').press('ArrowUp');await waitMode(p,1,2);await p.locator('.ww-legacy-toggle').click();
  await p.evaluate(()=>audit.node.port.postMessage({t:'drums',part:1,kit:0}));await p.waitForFunction(()=>audit.frame.engines[1]===2);assert(await p.locator('[data-performance-mode]').evaluateAll(xs=>xs.every(x=>x.disabled)));assert.equal(await p.locator('.ww-performance-modes [aria-pressed="true"]').count(),0);
  await p.evaluate(()=>audit.node.port.postMessage({t:'analog',part:1}));await p.waitForFunction(()=>audit.frame.engines[1]===0);await p.locator('.ww-legacy-toggle').click();await p.locator('.dial[aria-label="Part"]').press('ArrowDown');await p.waitForFunction(()=>audit.frame.track===0);await p.locator('.ww-legacy-toggle').click();await waitMode(p,0,3);
  await mode(p,0).click();await waitMode(p,0,0);
  const midi=(st,d1,d2)=>p.evaluate(([st,d1,d2])=>audit.sources[1].onmidimessage({data:[st,d1,d2]}),[st,d1,d2]);
  await midi(0xb0,64,127);for(const n of [60,64,67]){await midi(0x90,n,100);await midi(0x80,n,0);}await p.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===3);
  await p.evaluate(()=>{audit.sent=[];audit.programs=JSON.stringify(audit.frame.programs);});
  for(const id of ['diag','perf','osc','perf'])await go(p,id);await p.locator('.ww-legacy-toggle').click();await p.locator('.ww-legacy-toggle').click();
  assert.deepEqual(await p.evaluate(()=>audit.sent),[]);assert.equal(await p.evaluate(()=>audit.contexts),1);assert.equal(await p.evaluate(()=>audit.ready),1);assert.equal(await p.evaluate(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length),3);assert(await p.evaluate(()=>JSON.stringify(audit.frame.programs)===audit.programs));assert.equal(await p.locator('.ww-midi-setup').evaluate(n=>n.open),false);
  await midi(0xb0,64,0);await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
  // Automatic resume never opens setup; manual Resume audio does.
  await p.evaluate(async()=>{await audit.context.suspend();await audit.context.resume();});assert.equal(await p.locator('.ww-midi-setup').evaluate(n=>n.open),false);
  await p.evaluate(()=>audit.context.suspend());await p.getByRole('button',{name:'Resume audio',exact:true}).click();await p.locator('.ww-midi-setup[open]').waitFor();await ok(p);assert.equal(await p.evaluate(()=>audit.contexts),1);
  // Compare panel size and old-content positions against the measured v0.1 layout.
  const geometry={};for(const width of [1560,1440,1100,390]){await p.setViewportSize({width,height:1100});geometry[width]=await p.locator('.ww-musical-grid>section').last().evaluate(n=>({panel:n.getBoundingClientRect().toJSON(),children:[...n.children].map(x=>({tag:x.tagName,text:x.textContent,rect:x.getBoundingClientRect().toJSON()})),buttons:[...n.querySelectorAll('[data-performance-mode]')].map(x=>x.getBoundingClientRect().toJSON())}));const ys=geometry[width].buttons.map(x=>x.y);assert(ys.every(y=>Math.abs(y-ys[0])<1));assert(geometry[width].buttons.at(-1).right<=geometry[width].panel.right);}
  fs.writeFileSync(`${root}/layout-after.json`,JSON.stringify(geometry,null,2));
  const previous=JSON.parse(fs.readFileSync('tests/fixtures/ui-foundation-v1-panel.json','utf8'));for(const width of [1560,1440]){assert.equal(geometry[width].panel.width,previous[width].width);assert.equal(geometry[width].panel.height,previous[width].height);for(let i=0;i<5;i++)assert(Math.abs((geometry[width].children[i].rect.y-geometry[width].panel.y)-previous[width].contentTopOffsets[i])<1);}
  await p.setViewportSize({width:1560,height:1100});await p.screenshot({path:`${root}/performance-modes.png`,fullPage:true});
  await p.setViewportSize({width:390,height:844});await p.evaluate(()=>document.querySelector('.ww-topbar').scrollIntoView());await p.evaluate(()=>audit.context.suspend());await p.getByRole('button',{name:'Resume audio',exact:true}).click();await p.locator('.ww-midi-setup[open]').waitFor();await p.screenshot({path:`${root}/midi-setup-mobile.png`});assert(await p.locator('.ww-midi-setup').evaluate(n=>n.getBoundingClientRect().width<=innerWidth&&n.scrollWidth<=n.clientWidth));await ok(p);
  results.push({scenario:'devices and voice modes',result:'PASS',sameMidiNodes:true,profilePreserved:true,allFourModes:true,partSelection:true,legacyAndDiagnostics:true,drumGuard:true,sustainNavigation:true,contexts:1,automaticResumeNoModal:true,manualResumeSetup:true,desktopPanelUnchanged:true});await context.close();
  for(const scenario of ['empty','denied']){
    const {p,context}=await fixture(scenario);await start(p);
    if(scenario==='empty'){
      await ok(p);assert.equal(await p.evaluate(()=>audit.requests),0);await virtualKey(p);await p.locator('.ww-topbar').getByRole('button',{name:'Settings',exact:true}).click();
      await p.getByRole('button',{name:'Connect MIDI keyboard',exact:true}).click();assert((await p.locator('#midiStatus').textContent()).includes('No MIDI devices'));await p.getByRole('button',{name:'Close settings',exact:true}).click();
    }else{await p.getByRole('button',{name:'Connect MIDI keyboard',exact:true}).click();assert((await p.locator('#midiStatus').textContent()).includes('permission denied'));await ok(p);}
    await virtualKey(p);assert.equal(await p.evaluate(()=>audit.context.state),'running');assert(await p.evaluate(()=>localStorage.getItem('waswan-midi-profile-v1')===audit.profile));results.push({scenario,result:'PASS',virtualKeyboard:true,audioRunning:true,profilePreserved:true});await context.close();
  }
  const failure=await fixture();await failure.p.route('**/obervave-voice.wasm',route=>route.fulfill({status:500,body:'test failure'}));await failure.p.getByRole('button',{name:'Start audio',exact:true}).click();await failure.p.waitForFunction(()=>audit.context?.state==='closed');assert.equal(await failure.p.locator('.ww-midi-setup').evaluate(n=>n.open),false);assert(/iniciar|start/i.test(await failure.p.locator('#status').textContent()));await failure.p.unroute('**/obervave-voice.wasm');await start(failure.p);await ok(failure.p);results.push({scenario:'startup failure and retry',result:'PASS',noModalOnFailure:true});await failure.context.close();
  assert.deepEqual(allErrors,[]);const report={result:'PASS',chrome:await browser.version(),results,errors:allErrors};fs.writeFileSync(`${root}/browser.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
