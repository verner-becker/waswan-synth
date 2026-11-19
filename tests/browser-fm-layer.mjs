// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from './browser-foundation-controls.mjs';
const dir='.local/validation/fm-layer';fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.addInitScript(()=>{
    window.audit={windows:[]};const Node=AudioWorkletNode;
    window.AudioWorkletNode=class extends Node{
      constructor(...args){super(...args);audit.post=m=>this.port.postMessage(m);this.port.addEventListener('message',({data})=>{
        if(data.t==='frame')audit.frame=data;
        if(data.t==='dsp-window'&&!data.final)audit.windows.push(data);
      });}
    };
  });
  await page.goto('http://localhost:8737/simulator/');await startSynth(page);
  await page.locator('[data-workspace="tones"]').click();
  await page.getByRole('button',{name:'+ Add FM',exact:true}).click();
  const panel=page.locator('.ww-fm-panel');
  await panel.waitFor();await page.waitForFunction(()=>audit.frame.fm.bytes[4]===0);
  await panel.getByLabel('FM algorithm').selectOption({value:'3'});
  await page.waitForFunction(()=>audit.frame.fm?.bytes[1]===3);
  await panel.getByText('Feedback · OP 4 → OP 6').waitFor();
  await panel.getByLabel('Feedback',{exact:true}).fill('6');await panel.getByLabel('Feedback',{exact:true}).press('Tab');
  await panel.getByRole('button',{name:'Operator 6',exact:true}).click();
  await panel.getByLabel('Fine',{exact:true}).fill('23');await panel.getByLabel('Fine',{exact:true}).press('Tab');
  await page.waitForFunction(()=>audit.frame.fm.bytes[77]===23);
  await panel.getByLabel('FM level',{exact:true}).fill('82');await panel.getByLabel('FM level',{exact:true}).press('Tab');
  await page.waitForFunction(()=>audit.frame.fm.bytes[4]===82);
  await page.screenshot({path:dir+'/editor.png'});
  await page.getByRole('button',{name:'Mix',exact:true}).click();await page.locator('.ww-fm-mix').waitFor();
  await page.getByRole('button',{name:'Analog',exact:true}).click();await page.locator('.ww-osc-bank:visible').waitFor();
  await page.getByRole('button',{name:'FM',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert(await panel.evaluate(p=>p.getBoundingClientRect().right<=innerWidth));
  await page.screenshot({path:dir+'/mobile.png'});await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>{
    const set=(id,value)=>audit.post({t:'editor-set',id,value,scope:audit.frame.instrument.scope});
    set(47,0);set(38,1);set(0,1);set(4,1);
    audit.post({t:'voice-sustain',enabled:true});
  });
  const report=[];let previous=0;
  for(const voices of [16,64,128,256]){
    await page.evaluate(([first,last])=>{
      for(let n=first;n<last;n++)audit.post({t:'midi',st:144,d1:n,d2:90});
      for(let n=first;n<last;n++)audit.post({t:'midi',st:128,d1:n,d2:0});
    },[previous,voices/2]);previous=voices/2;
    await page.waitForFunction(n=>audit.frame.polyphony.slots.filter(v=>v.gate).length===n,voices);
    const session='fm-'+voices;
    await page.evaluate(session=>audit.post({t:'dsp-control',action:'start',session}),session);
    await page.waitForFunction(session=>audit.windows.filter(w=>w.session===session).length>=3,session,{timeout:90000});
    const metrics=await page.evaluate(async session=>{
      const {accumulator,merge,metrics}=await import('./dsp-stats.js'),all=accumulator();
      for(const w of audit.windows.filter(w=>w.session===session))merge(all,w.stats);
      return metrics(all);
    },session);
    report.push({voices,blocks:metrics.blocks,meanMs:metrics.meanMs,p99Ms:metrics.p99Ms,overBudget:metrics.overBudget});
  }
  await page.evaluate(()=>audit.post({t:'voice-sustain',enabled:false}));
  await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate&&!v.active),null,{timeout:30000});
  await page.getByRole('button',{name:'Mix',exact:true}).click();
  await page.locator('.ww-fm-mix input').first().press('Home');
  await page.waitForFunction(()=>audit.frame.fm?.bytes[3]===0);
  await page.getByRole('button',{name:'Save as…',exact:true}).click();
  const dialog=page.locator('.ww-editor-save');
  await dialog.getByLabel('Tone name').fill('FM TEST');
  await dialog.getByLabel('Destination program').selectOption({value:'99'});
  await dialog.getByRole('button',{name:'Confirm overwrite'}).click();
  await page.waitForFunction(()=>document.querySelector('.ww-tone-editor [role="status"]').textContent.includes('browser storage updated'));
  await page.reload();await startSynth(page);await page.locator('[data-workspace="tones"]').click();
  await page.waitForFunction(()=>audit.frame.editor.available);
  await page.getByLabel('Tone program').selectOption({value:'99'});
  const discard=page.getByRole('button',{name:'Discard and load',exact:true});
  if(await discard.isVisible())await discard.click();
  await page.waitForFunction(()=>audit.frame.instrument.name==='FM TEST'&&audit.frame.fm?.bytes[4]===82);
  await panel.waitFor();
  await page.getByRole('button',{name:'+ Add Analog',exact:true}).click();
  await page.waitForFunction(()=>audit.frame.fm?.bytes[3]===127);
  assert.deepEqual(errors,[]);fs.writeFileSync(dir+'/chrome-dsp.json',JSON.stringify({browser:await browser.version(),report},null,2));console.table(report);
}finally{await browser.close();}
