// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.audit={};const source={id:'test',name:'private source',state:'connected',async open(){},async close(){}};audit.source=source;
  navigator.requestMIDIAccess=async()=>({inputs:new Map([['test',source]])});
  localStorage.setItem('waswan-midi-profile-v1',JSON.stringify({version:1,enabled:true,bindings:[{port:source.name,channel:5,cc:49,target:'enc:1',mode:'absolute',behavior:'fine'}]}));
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...a){super(...a);audit.node=this;this.port.addEventListener('message',e=>{if(e.data.t==='frame')audit.frame=e.data;});}};
 });
 await page.goto('http://localhost:8738/simulator/');await page.locator('#power').click();await page.waitForFunction(()=>audit.frame?.ms>5000);await page.locator('#midiConnect').click();await page.waitForFunction(()=>document.querySelector('#midiStatus').textContent.includes('conectada:'));
 await page.evaluate(()=>audit.node.port.postMessage({t:'midi',st:0xb0,d1:71,d2:20}));await page.waitForFunction(()=>audit.frame.knobControl.parameters[1].value===20);
 await page.locator('.waswan-midi-diagnostic summary').click();await page.locator('[data-midi-log-start]').click();await page.waitForFunction(()=>document.querySelector('[data-midi-log-status]').textContent.includes('conexão local confirmada'));
 await page.evaluate(()=>{for(const value of [53,54,100,127,127])audit.source.onmidimessage({data:[181,49,value]});audit.source.onmidimessage({data:[144,60,100]});});
 await page.waitForFunction(()=>audit.frame.knobControl.parameters[1].value===94);await page.waitForTimeout(400);await page.locator('[data-midi-log-mark]').click();await page.locator('[data-midi-log-stop]').click();
 await page.waitForFunction(()=>{const t=document.querySelector('[data-midi-log-status]').textContent;return t.includes('Encerrado')&&!t.includes('falha')&&!document.querySelector('[data-midi-log-start]').disabled;});
 const dp=page.waitForEvent('download');await page.locator('[data-midi-log-export]').click();await(await dp).saveAs('.local/validation/midi-diagnostic-export.jsonl');const raw=fs.readFileSync('.local/validation/midi-diagnostic-export.jsonl','utf8'),rows=raw.trim().split('\n').map(JSON.parse);
 const cc=rows.filter(r=>r.type==='cc');assert.deepEqual(cc.map(r=>r.value),[53,54,100,127,127]);assert.deepEqual(cc.map(r=>r.rawDelta),[null,1,46,27,0]);assert.equal(cc[0].disposition,'mapped-no-command');assert.equal(cc[1].commands[0].steps,1);assert(rows.some(r=>r.type==='marker'));assert(rows.some(r=>r.type==='state'&&r.parameters[1].value===94));assert(!raw.includes('private source'));
 const live=fs.readFileSync('.local/validation/midi-diagnostic-server/midi-live-'+rows[0].session+'.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(live,rows);
 // Replay a batch: exact retries must not duplicate records.
 const endpoint='http://localhost:8738/diagnostics/midi';const withoutSession=rows.map(({session,...r})=>r);const post=async(body,origin='http://localhost:8738')=>fetch(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({session:rows[0].session,records:withoutSession.slice(0,5)})).status,204);
 assert.equal(fs.readFileSync('.local/validation/midi-diagnostic-server/midi-live-'+rows[0].session+'.jsonl','utf8').trim().split('\n').length,rows.length);
 assert.equal((await post({session:crypto.randomUUID(),records:[{type:'cc',seq:0,raw:[144,60,100]}]})).status,400);
 assert.equal((await post({session:crypto.randomUUID(),records:[{type:'marker',seq:0}]},'http://example.com')).status,403);
 assert.equal((await post({session:'../../escape',records:[{type:'marker',seq:0}]})).status,400);
 await page.setViewportSize({width:390,height:844});assert(await page.locator('.waswan-midi-diagnostic').evaluate(e=>e.getBoundingClientRect().width<=innerWidth));
 assert.deepEqual(errors,[]);const report={result:'PASS',rawValues:cc.map(r=>r.value),softwareOffsetReproduced:{midiStart:53,paramStart:20,midiEnd:127,paramEnd:94},identicalLiveAndExport:true,retryIdempotent:true,notesExcluded:true,originChecked:true,privacy:true,errors};fs.writeFileSync('.local/validation/midi-diagnostic-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
