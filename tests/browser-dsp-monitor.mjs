// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.audit={errors:[],windows:0};const AC=AudioContext;window.AudioContext=class extends AC{constructor(o){super(o);audit.context=this;}};
  const AN=AudioWorkletNode;window.AudioWorkletNode=class extends AN{constructor(...args){super(...args);audit.node=this;this.port.addEventListener('message',e=>{if(e.data.t==='frame')audit.frame=e.data;if(e.data.t==='dsp-window'){audit.latest=e.data;audit.windows++;}if(e.data.t==='error')audit.errors.push(e.data.message);});}};
 });
 await page.goto('http://localhost:8737/simulator/');
 // Showing before startup must activate correctly after original ready handling.
 await page.locator('[data-dsp-toggle]').click();assert(await page.locator('[data-dsp-start]').isDisabled());
 await page.locator('#power').click();await page.waitForFunction(()=>audit.frame?.ms>5000);
 await page.waitForFunction(()=>audit.latest?.stats.blocks>0);
 await page.locator('[data-voice-mode="1"]').click();
 await page.evaluate(()=>{for(let n=0;n<128;n++)audit.node.port.postMessage({t:'midi',st:0x90,d1:n,d2:100});const a=audit.context.createAnalyser();audit.node.connect(a);audit.analyser=a;});
 await page.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===256);
 const cdp=await context.newCDPSession(page),system=await browser.newBrowserCDPSession();
 const cpu=async()=>{const x=await system.send('SystemInfo.getProcessInfo');return x.processInfo.filter(p=>p.type==='renderer').reduce((s,p)=>s+p.cpuTime,0);};
 const bench={off:[],live:[],capture:[]};
 for(let round=0;round<3;round++)for(const mode of (round%2?['capture','live','off']:['off','live','capture'])){
  if(await page.locator('.waswan-dsp').isVisible())await page.locator('[data-dsp-toggle]').click();
  if(mode!=='off')await page.locator('[data-dsp-toggle]').click();
  if(mode==='capture')await page.locator('[data-dsp-start]').click();
  await page.waitForTimeout(1000);const before=await cpu(),t=Date.now();await page.waitForTimeout(10000);const elapsed=Date.now()-t;
  bench[mode].push({cpuSeconds:await cpu()-before,wallMs:elapsed});
  if(mode==='capture'){await page.locator('[data-dsp-stop]').click();await page.waitForFunction(()=>document.querySelector('[data-dsp-state]').textContent.includes('inativa'));}
 }
 if(!await page.locator('.waswan-dsp').isVisible())await page.locator('[data-dsp-toggle]').click();
 await page.locator('[data-dsp-start]').click();
 // Prolonged real AudioWorklet run; retain only latest worklet message in the test itself.
 const memory=[],startAudio=await page.evaluate(()=>audit.frame.ms),started=Date.now();
 for(let i=0;i<7;i++){
  await cdp.send('HeapProfiler.collectGarbage');const usage=await cdp.send('Runtime.getHeapUsage');memory.push({wallMs:Date.now()-started,usedSize:usage.usedSize});
  if(i<6)await page.waitForTimeout(30000);
 }
 const audioProgress=await page.evaluate(before=>audit.frame.ms-before,startAudio);assert(audioProgress>175000);
 await page.locator('[data-dsp-stop]').click();await page.waitForFunction(()=>document.querySelector('[data-dsp-state]').textContent.includes('inativa'));
 const downloadPromise=page.waitForEvent('download');await page.locator('[data-dsp-export]').click();const download=await downloadPromise;const file='.local/validation/'+download.suggestedFilename();await download.saveAs(file);
 const lines=fs.readFileSync(file,'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(lines[0].type,'start');assert.equal(lines.at(-1).type,'summary');const windows=lines.filter(l=>l.type==='window'),summary=lines.at(-1);
 assert(windows.length>=175&&windows.length<=185);assert.equal(summary.blocks,windows.reduce((s,w)=>s+w.blocks,0));assert.equal(summary.measuredBlocks,windows.reduce((s,w)=>s+w.measuredBlocks,0));assert.equal(summary.peakVoices,256);
 assert.equal(summary.poolCapacity,256);assert.equal(summary.sampleRate,44100);assert.equal(summary.reason,'user');assert(windows.every(w=>w.frames===128&&w.voices.gate===256&&w.session===summary.session));
 if(summary.measuredBlocks){assert.equal(summary.measurement.clock,'Date.now');assert.equal(summary.measurement.quality,'coarse-wall-clock');assert(Math.abs(summary.meanMs-windows.reduce((s,w)=>s+(w.meanMs??0)*w.measuredBlocks,0)/summary.measuredBlocks)<1e-9);}
 const text=JSON.stringify(lines);assert(!/SMK-37|\/home\/|noteOn|midiDevice/.test(text));
 // Memory growth stays bounded rather than proportional to audio blocks; windows only.
 assert(memory.at(-1).usedSize-memory[0].usedSize<8*1024*1024,'excessive main-thread retained heap growth');
 const audio=await page.evaluate(()=>{const d=new Float32Array(2048);audit.analyser.getFloatTimeDomainData(d);return {state:audit.context.state,peak:Math.max(...d.map(Math.abs)),finite:Array.from(d).every(Number.isFinite)};});assert.equal(audio.state,'running');assert(audio.peak>0&&audio.finite);
 await page.setViewportSize({width:390,height:844});const width=await page.locator('.waswan-dsp').evaluate(e=>e.getBoundingClientRect().width);assert(width<=390);
 await page.screenshot({path:'.local/validation/dsp-monitor-mobile.png',fullPage:true});
 await page.locator('[data-dsp-clear]').click();assert(await page.locator('[data-dsp-export]').isDisabled());
 await page.locator('[data-dsp-start]').click();await page.waitForTimeout(1200);await page.locator('[data-dsp-toggle]').click();assert(await page.locator('.waswan-dsp').isHidden());
 await page.waitForTimeout(1200);await page.locator('[data-dsp-toggle]').click();await page.locator('[data-dsp-stop]').click();await page.waitForFunction(()=>document.querySelector('[data-dsp-state]').textContent.includes('inativa'));
 const nextDownload=page.waitForEvent('download');await page.locator('[data-dsp-export]').click();const next=await nextDownload;await next.saveAs('.local/validation/dsp-monitor-restart.jsonl');const nextLines=fs.readFileSync('.local/validation/dsp-monitor-restart.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.notEqual(nextLines[0].session,lines[0].session);assert(nextLines.at(-1).blocks<summary.blocks);
 // Exercise the bounded logger at its one-hour limit using small synthetic aggregate windows.
 await page.locator('[data-dsp-start]').click();await page.waitForFunction(()=>audit.latest.session!==null&&audit.latest.session!==null);
 await page.waitForTimeout(1100);
 await page.evaluate(async()=>{const {updateDspMonitor}=await import('./dsp-monitor.js');const {accumulator,block}=await import('./dsp-stats.js');const s=audit.latest.session;const a=accumulator();block(a,0,128,44100);for(let i=0;i<3610;i++)updateDspMonitor({t:'dsp-window',session:s,stats:a,voices:{active:256,gate:256,release:0,capacity:256},sampleRate:44100,measurement:{state:'available',quality:'synthetic-limit-test'}});});
 assert((await page.locator('[data-dsp-state]').textContent()).includes('inativa'));
 const limitDownload=page.waitForEvent('download');await page.locator('[data-dsp-export]').click();await(await limitDownload).saveAs('.local/validation/dsp-monitor-limit.jsonl');const limit=fs.readFileSync('.local/validation/dsp-monitor-limit.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.equal(limit.filter(r=>r.type==='window').length,3600);assert.equal(limit.at(-1).reason,'window-limit');
 errors.push(...await page.evaluate(()=>audit.errors));assert.deepEqual(errors,[]);
 const median=v=>[...v].sort((a,b)=>a-b)[1];const medians=Object.fromEntries(Object.entries(bench).map(([k,v])=>[k,median(v.map(r=>r.cpuSeconds*1000/r.wallMs))]));
 const report={result:'PASS',browser:await browser.version(),benchmark:{scope:'all renderer process CPU seconds / wall seconds; includes UI, not isolated DSP',runs:bench,medianCpuCores:medians},prolonged:{wallMs:Date.now()-started,audioProgressMs:audioProgress,memory,exportedWindows:windows.length},summary,privacy:true,restart:true,hiddenCapture:true,limitWindows:3600,audio,mobilePanelWidth:width,errors};fs.writeFileSync('.local/validation/dsp-monitor-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
