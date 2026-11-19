// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from './browser-foundation-controls.mjs';

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page=await browser.newPage(),report=[];
  await page.addInitScript(()=>{
    window.audit={windows:[]};
    const Node=AudioWorkletNode;
    window.AudioWorkletNode=class extends Node {
      constructor(...args){
        super(...args);
        this.port.addEventListener('message',({data})=>{
          if(data.t==='frame'){audit.frame=data;audit.node=this;}
          if(data.t==='dsp-window'&&!data.final)audit.windows.push(data);
        });
      }
    };
  });
  await page.goto('http://localhost:8737/simulator/');
  await startSynth(page);
  await page.evaluate(()=>{
    const post=m=>audit.node.port.postMessage(m);
    audit.set=(id,value)=>post({t:'editor-set',id,value,scope:audit.frame.instrument.scope});
    audit.notes=(start,end)=>{
      for(let note=start;note<end;note++)post({t:'midi',st:144,d1:note,d2:80});
      for(let note=start;note<end;note++)post({t:'midi',st:128,d1:note,d2:0});
    };
    post({t:'voice-sustain',enabled:true});
    audit.set(38,1); // DUAL uses two voices per key, permitting a full pool on one channel.
    audit.set(0,1);audit.set(4,1);

  });
  let previousKeys=0;
  for(const voices of [16,64,128,256]){
    await page.evaluate(([start,end])=>audit.notes(start,end),[previousKeys,voices/2]);
    previousKeys=voices/2;
    for(const oscillators of [2,4]){
      await page.evaluate(oscillators=>{
        audit.set(63,oscillators===4?7:0);
        audit.set(66,oscillators===4?3:0);
      },oscillators);
      await page.waitForFunction(([v,o])=>audit.frame.polyphony.slots.filter(s=>s.gate).length===v&&
        audit.frame.editor.values[66].value===(o===4?3:0),[voices,oscillators]);
      const session='osc-'+voices+'-'+oscillators;
      await page.evaluate(session=>audit.node.port.postMessage({t:'dsp-control',action:'start',session}),session);
      await page.waitForFunction(session=>audit.windows.filter(w=>w.session===session).length>=5,session,{timeout:60000});
      const metrics=await page.evaluate(async session=>{
        const {merge,metrics,accumulator}=await import('./dsp-stats.js');
        const windows=audit.windows.filter(w=>w.session===session),total=accumulator();
        for(const window of windows)merge(total,window.stats);
        return {...metrics(total),clock:windows[0].measurement.clock};
      },session);
      assert.equal(metrics.peakVoices,voices);
      report.push({voices,oscillators,...metrics});
    }
  }
  await page.evaluate(()=>audit.node.port.postMessage({t:'voice-sustain',enabled:false}));
  await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate&&!v.active));
  const dir='.local/validation/analog-four-oscillators';
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(dir+'/chrome-dsp.json',JSON.stringify({chrome:await browser.version(),report},null,2));
  console.table(report.map(({voices,oscillators,blocks,meanMs,p99Ms,overBudget})=>({voices,oscillators,blocks,meanMs,p99Ms,overBudget})));
} finally {
  await browser.close();
}
