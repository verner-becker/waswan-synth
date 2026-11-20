// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {pcmWav} from './fixtures.mjs';

const evidence = '.local/validation/sampler-ux-2';
await mkdir(evidence,{recursive:true});
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const page = await browser.newPage({viewport:{width:1440,height:960}});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', dialog => dialog.accept());
const name = 'History lab';
const source = Buffer.from(pcmWav(Int16Array.from({length:88200}, (_,i) =>
  Math.round(10000*Math.sin(2*Math.PI*(i < 44100 ? 220 : 440)*i/44100))), {channels:1}));
try {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('History library',{create:true});
    window.audit = {live:0,hosts:0,auditions:[]};
    const connect = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function(media) {
      audit.auditions.push(fetch(media.src).then(r=>r.blob()).then(async file=>{
        const {decodeWav}=await import('./sampler-wav.js');
        const {pcm,channels}=await decodeWav(file);
        let rises=0;
        for(let i=1001;i<=23050;i++) if(pcm[(i-1)*channels]<=0 && pcm[i*channels]>0) rises++;
        return rises*2;
      }));
      return connect.call(this,media);
    };
    const Worklet = AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'obervave-smk37') return;
        audit.hosts++;
        const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message,...transfer) => {
          if(message.t === 'daw-sampler-live') audit.live++;
          send(message,...transfer);
        };
        this.port.addEventListener('message',({data}) => {if(data.t==='frame') audit.frame=data;});
      }
    };
  });
  await page.goto(process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/');
  await startSynth(page);
  const studio=page.locator('[data-view=sampler]');
  const b=text=>studio.getByRole('button',{name:text,exact:true});
  const f=text=>studio.getByLabel(text,{exact:true});
  const idle=()=>page.waitForFunction(()=>!document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  const press=async text=>{await b(text).click();await idle();};
  const set=async(text,value)=>{await f(text).fill(value);await f(text).press('Tab');await idle();};
  await page.locator('[data-workspace=sampler]').click();
  await press('Choose Samples folder…');
  await f('Import WAV').setInputFiles({name:'History lab.wav',mimeType:'audio/wav',buffer:source});
  await page.waitForFunction(()=>document.querySelector('.ww-sampler-status').textContent.startsWith('Original imported'));
  await idle();
  await set('Working name',name);
  await press('Promote to Official');
  await studio.getByText('Advanced Tools',{exact:true}).click();
  await studio.locator('.ww-wave-tools > summary').click();
  await set('Waveform slice markers','111, 222');
  await set('Checkpoint name','Before experiment');
  await press('Create Checkpoint');
  await set('Working name','Alternate take');
  await press('Undo working edit');
  assert.equal(await f('Working name').inputValue(),name);
  await press('Redo working edit');
  assert.equal(await f('Working name').inputValue(),'Alternate take');
  await f('Processing operation').selectOption('reverse');
  await press('Add stage');
  await press('Render Version');
  await press('Promote to Official');
  const select=label=>studio.getByRole('combobox',{name:new RegExp('^'+label)});
  await select('Compare A').selectOption('original');
  await select('Compare B').selectOption('working');
  const beforeInspect=await page.evaluate(()=>audit.auditions.length);
  await press('View waveform for Before experiment');
  assert.match(await f('Editor audio').inputValue(),/^checkpoint:/);
  assert.equal(await f('End frame').inputValue(),'88200');
  await press('View waveform for Original');
  assert.equal(await f('Editor audio').inputValue(),'original');
  assert.equal(await page.evaluate(()=>audit.auditions.length),beforeInspect);
  await press('View waveform for Working');
  await press('Listen A');
  await press('Listen B');
  await press('Stop comparison');
  const tones=await page.evaluate(()=>Promise.all(audit.auditions.slice(-2)));
  assert.deepEqual(tones,[220,440]);
  await page.screenshot({path:evidence+'/history.png'});
  await studio.locator('.ww-sampler-full-history > summary').click();
  await press('Restore Checkpoint');
  assert.equal(await f('Waveform slice markers').inputValue(),'111, 222');
  assert.equal(await f('Working name').inputValue(),name);
  await press('Save Working');
  await set('Previous Official revision','1');
  await press('Re-promote Previous');
  await set('Working name','Discard me');
  await press('Discard Working');
  assert.equal(await f('Working name').inputValue(),name);
  await press('Branch from Here');
  await set('Working name','Second experiment');
  await press('Save Working');
  await press('Start Again from Original');
  assert.equal(await studio.locator('.ww-sampler-stages li').count(),0);
  const verify=async()=>{
    const {search,load,readLibrary,readSampleFile}=await import('./sampler-library.js');
    const root=await showDirectoryPicker();
    const item=(await search(root,{kind:'instrument'})).items[0];
    const library=await readLibrary(root);
    const revisions=[];
    for(let revision=1;revision<=item.revision;revision++){
      const model=await load(root,{type:'sampler',libraryId:library.id,instrumentId:item.id,revision,path:item.path});
      await readSampleFile(root,model.samples[0]);
      revisions.push({revision,name:model.name,hash:model.samples[0].sha256});
    }
    return revisions;
  };
  const revisions=await page.evaluate(verify);
  assert.equal(revisions.length,3);
  assert.equal(revisions[0].hash,revisions[2].hash);
  assert.notEqual(revisions[0].hash,revisions[1].hash);
  assert.equal(await page.evaluate(()=>audit.hosts),1);
  assert.equal(await page.evaluate(()=>audit.live),0);
  assert.deepEqual(errors,[]);
  await writeFile(evidence+'/chrome.json',JSON.stringify({browser:browser.version(),revisions,tones},null,2));
  console.log('PASS sampler history, comparison, immutable revisions and keyboard ownership',revisions);
} catch(error) {
  console.error(await page.locator('.ww-sampler-status').allTextContents());
  await page.screenshot({path:evidence+'/failure.png'});
  throw error;
} finally {await browser.close();}
