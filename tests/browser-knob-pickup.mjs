// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';import fs from 'node:fs';import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{window.audit={};const s={id:'test',name:'synthetic',state:'connected',async open(){},async close(){}};audit.source=s;navigator.requestMIDIAccess=async()=>({inputs:new Map([['test',s]])});
  if(!localStorage.getItem('waswan-midi-profile-v1'))localStorage.setItem('waswan-midi-profile-v1',JSON.stringify({version:1,enabled:true,bindings:[{port:s.name,channel:5,cc:49,target:'enc:1',mode:'absolute',behavior:'fine'}]}));
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...a){super(...a);audit.node=this;this.port.addEventListener('message',e=>{if(e.data.t==='frame')audit.frame=e.data;if(e.data.t==='error')throw Error(e.data.message);});}};});
 async function boot(){await p.locator('#power').click();await p.waitForFunction(()=>audit.frame?.ms>5000);await p.locator('#midiConnect').click();await p.waitForFunction(()=>document.querySelector('#midiStatus').textContent.includes('conectada:'));await p.locator('.waswan-profile summary').click();}
 const cc=async v=>p.evaluate(v=>audit.source.onmidimessage({data:[181,49,v]}),v);
 const waitVal=async v=>p.waitForFunction(v=>audit.frame.knobControl.parameters[1].value===v,v);
 await p.goto('http://localhost:8737/simulator/?legacy=1&lang=pt');await boot();await waitVal(20);
 for(const v of [53,100,127])await cc(v);await p.waitForTimeout(120);assert.equal(await p.evaluate(()=>audit.frame.knobControl.parameters[1].value),20);assert((await p.locator('[data-pickup="enc:1"]').textContent()).includes('CC 20'));
 await cc(20);await p.waitForFunction(()=>document.querySelector('[data-pickup="enc:1"]').textContent.includes('sincronizada'));
 for(const v of [21,22,127,126,0,1,127,0]){await cc(v);await waitVal(v);}
 // Reconnect/focus preserve the patch and rearm pickup, then reach both ends again.
 await cc(60);await waitVal(60);await p.locator('#midiInput').selectOption('');await p.locator('#midiInput').selectOption('test');await p.waitForTimeout(150);await cc(100);await p.waitForTimeout(100);await waitVal(60);await cc(60);await cc(127);await waitVal(127);
 await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await p.waitForTimeout(120);await cc(50);await p.waitForTimeout(120);await waitVal(127);await cc(127);await cc(0);await waitVal(0);
 // Full reload leaves mappings fine/absolute; the new engine starts with the patch's stored RESO20.
 await p.reload();await boot();await waitVal(20);await cc(53);await p.waitForTimeout(100);await waitVal(20);await cc(20);await cc(127);await waitVal(127);await cc(0);await waitVal(0);
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:'.local/validation/knob-pickup-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 const report={result:'PASS',physicalCase:'53/20 waits; pickup at20 then0..127',unitSteps:true,roundTrips:true,reconnect:true,focus:true,hardReload:true,mappingPreserved:true,uiPickupIndicator:true,errors};fs.writeFileSync('.local/validation/knob-pickup-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await b.close();}
