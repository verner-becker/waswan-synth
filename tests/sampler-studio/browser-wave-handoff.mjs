// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {pcmWav} from './fixtures.mjs';

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const page=await browser.newPage();page.setDefaultTimeout(10000);
page.on('dialog',dialog=>dialog.accept());
try {
  await page.addInitScript(()=>{
    window.audit={};
    window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('Edited samples',{create:true});
    const Original=AudioWorkletNode;
    window.AudioWorkletNode=class extends Original {
      constructor(...args){super(...args);if(args[1]==='obervave-smk37')this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});}
    };
  });
  await page.goto(process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/');
  await startSynth(page);
  await page.locator('[data-workspace=sampler]').first().click();
  const pane=page.locator('[data-view=sampler]'),field=name=>pane.getByLabel(name,{exact:true});
  const b=name=>pane.getByRole('button',{name,exact:true});
  const idle=()=>page.waitForFunction(()=>!document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  const press=async name=>{await b(name).click();await idle();};
  const set=async(name,value)=>{await field(name).fill(String(value));await field(name).press('Tab');await idle();};
  const reveal=async locator=>{
    const hiddenSummaries=await locator.evaluate(node=>{
      const ancestors=[];for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)ancestors.unshift(p.querySelector(':scope>summary').textContent);
      return ancestors;
    });
    for(const summary of hiddenSummaries)await pane.locator('summary').filter({hasText:summary}).first().click();
  };
  await press('Choose Samples folder…');
  const frames=44100;
  const wav=Buffer.from(pcmWav(Int16Array.from({length:frames},(_,i)=>Math.round(6000*Math.sin(i/27))),{channels:1}));
  await field('Import WAV').setInputFiles({name:'Loop source.wav',mimeType:'audio/wav',buffer:wav});
  await page.waitForFunction(()=>document.querySelector('.ww-sampler-status').textContent.startsWith('Original imported'));
  await set('Working name','Loop map');
  await set('Start frame',4000);await set('End frame',30000);
  await reveal(field('Waveform slice markers'));
  await set('Waveform slice markers','8000,16000');
  await press('Save Working');
  await field('Editor audio').selectOption('working');await idle();
  await press('Use slices in kit builder');
  await page.waitForFunction(()=>document.querySelector('.ww-sampler-studio>.ww-sampler-status').textContent.includes('Render this Working version'));
  await field('Editor audio').selectOption('source');await idle();
  assert.equal(await field('Waveform slice markers').inputValue(),'8000, 16000');
  await press('Use slices in kit builder');
  assert.equal(await field('Slice markers (frames)').inputValue(),'8000, 16000');
  await field('Region loop mode').selectOption('pingPong');await set('Region loop crossfade (frames)',220);
  await press('Use selection as region loop');
  await page.waitForFunction(()=>document.querySelector('.ww-sampler-studio>.ww-sampler-status').textContent.includes('Region loop applied'));
  await press('Save Working');await press('Promote to Official');
  await set('Builder name','Cuts kit');await press('Build kit from slices');await press('Save Working');await press('Promote to Official');
  const result=await page.evaluate(async()=>{
    const {search,readLibrary,load,readSampleFile}=await import('./sampler-library.js');
    const root=await showDirectoryPicker(),lib=await readLibrary(root);
    const open=async kind=>{
      const [item]=(await search(root,{kind})).items;
      return load(root,{type:'sampler',libraryId:lib.id,instrumentId:item.id,revision:item.revision,path:item.path});
    };
    const map=await open('instrument'),kit=await open('kit');
    await readSampleFile(root,map.samples[0]);
    const {listWorking,openWorking}=await import('./sampler-working.js');
    const saved=await Promise.all((await listWorking(root)).map(item=>openWorking(root,item.id)));
    return {loop:map.regions[0].loop,pads:kit.pads.length,ranges:kit.regions.map(r=>r.frames),sameHash:kit.samples[0].sha256===map.samples[0].sha256,
      persistedMarkers:saved.find(d=>d.sliceMarkers?.length)?.sliceMarkers};
  });
  assert.deepEqual(result,{loop:{start:4000,end:30000,mode:'pingPong',crossfade:220},pads:3,ranges:[[0,8000],[8000,16000],[16000,44100]],
    sameHash:true,persistedMarkers:[8000,16000]});
  console.log('PASS transient Working output rejected, source markers reopened, published loop and three-pad slice kit reopened via OPFS picker double with matching source digest',result);
} catch(error){
  console.error(await page.locator('.ww-sampler-studio>.ww-sampler-status').allTextContents());
  throw error;
} finally{await browser.close();}
