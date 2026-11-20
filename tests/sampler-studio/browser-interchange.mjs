// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';

const evidence='.local/validation/sampler-ux-5';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.setDefaultTimeout(6000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{
    window.audit={};
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet{constructor(...args){super(...args);
      if(args[1]==='obervave-smk37')this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
    }};
    window.pick=async name=>(await navigator.storage.getDirectory()).getDirectoryHandle(name,{create:true});
    window.showDirectoryPicker=async({id})=>{
      if(audit.rejectPicker){const code=audit.rejectPicker;delete audit.rejectPicker;throw new DOMException('Folder unavailable',code);}
      return pick(id);
    };
  });
  await page.goto(process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/');
  await startSynth(page);
  await page.evaluate(async()=>{
    const {initializeLibrary,importOriginal,publish}=await import('./sampler-library.js');
    const {encodeSample}=await import('./sampler-offline.js');
    const {createInstrument}=await import('./sampler-instrument.js');
    const root=await pick('waswan-samples');
    await initializeLibrary(root);
    const samples=[];
    for(const [id,hz] of [['tap',220],['ring',440]]){
      const pcm=Float32Array.from({length:2000},(_,i)=>.4*Math.sin(i*2*Math.PI*hz/44100));
      const wav=encodeSample({pcm,sampleRate:44100,channels:1});
      const original=await importOriginal(root,wav,'Samples/Originals/'+id+'.wav',{id,license:'CC0'});
      samples.push(original);
      await importOriginal(root,wav,'Samples/Originals/Recovered/'+id+'.wav',{name:'Recovered '+id});
    }
    const instrument=createInstrument({name:'Broken bells',samples,pan:.3,regions:samples.map((s,i)=>({
      id:'r'+i,root:60+i,key:[60+i,60+i],sample:s.id,group:'main'}))});
    audit.ref=await publish(root,instrument,{path:'Instruments/Broken bells',expectedRevision:0});
    const originals=await(await root.getDirectoryHandle('Samples')).getDirectoryHandle('Originals');
    for(const s of samples)await originals.removeEntry(s.id+'.wav');
  });
  const studio=page.locator('[data-view=sampler]'),panel=studio.locator('.ww-sampler-interchange');
  const b=(scope,label)=>scope.getByRole('button',{name:label,exact:true});
  const f=label=>panel.getByLabel(label,{exact:true});
  const idle=()=>page.waitForFunction(()=>!document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  const press=async(label,scope=panel)=>{await b(scope,label).click();await idle();};
  const open=async title=>{
    const summary=panel.getByText(title,{exact:true}).and(panel.locator('summary'));
    if(!await summary.evaluate(s=>s.parentElement.open))await summary.click();
  };
  const status=studio.locator('.ww-sampler-status').first();
  await page.locator('[data-workspace=sampler]').click();
  await press('Choose Samples folder…',studio);
  await press('Instruments',studio);await press('Broken bells',studio);
  assert.match(await status.innerText(),/missing/i);
  await open('Dependencies and portable copy');
  await press('Check dependencies');
  assert.equal(await panel.getByText(/missing-sample/).count(),2);
  for(const id of ['tap','ring']){
    const row=panel.locator('.ww-sampler-file-report li').filter({hasText:id+'.wav'});
    await press('Find matching WAVs',row);
    await f('Replacement for '+id).selectOption('Samples/Originals/Recovered/'+id+'.wav');
  }
  await press('Relink selected WAVs');assert.match(await status.innerText(),/Official r2/);
  const opening=page.waitForEvent('popup');
  await b(studio,'Open Sampler in new window').click();
  const popup=await opening;
  popup.setDefaultTimeout(6000);
  await popup.evaluate(()=>{
    window.pickerCalls=0;
    window.showDirectoryPicker=async()=>{
      pickerCalls++;
      throw new DOMException('Folder unavailable',pickerCalls===1?'NotAllowedError':'AbortError');
    };
  });
  const fromPopup=popup.getByRole('button',{name:'Collect portable instrument…'});
  for(const title of ['Library & Metadata','Dependencies and portable copy']){
    const summary=popup.getByText(title,{exact:true}).and(popup.locator('summary'));
    if(!await summary.evaluate(s=>s.parentElement.open))await summary.click();
  }
  await fromPopup.click();
  await popup.waitForFunction(()=>!document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  assert.match(await popup.locator('.ww-sampler-status').first().innerText(),/grant readwrite access/i);
  await fromPopup.click();
  await popup.waitForFunction(()=>!document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  assert.equal(await popup.evaluate(()=>pickerCalls),2);
  await popup.getByRole('button',{name:'Dock Sampler Studio',exact:true}).click();
  await press('Collect portable instrument…');assert.match(await status.innerText(),/Portable copy verified/);
  await open('Official metadata');await press('Inspect Official metadata');
  await f('Official title').fill('Repaired bells');await f('Official tags (comma separated)').fill('metal, percussion');
  await press('Publish metadata revision');assert.match(await status.innerText(),/r3/);
  await open('SFZ and Mellotron');await f('Instrument or export folder name').fill('Bells interchange');
  await press('Review conversion');
  assert(await b(panel,'Write reviewed conversion…').isDisabled());
  await f('Accept the reported conversion losses').check();
  await press('Write reviewed conversion…');assert.match(await status.innerText(),/Export verified/);
  await f('Interchange operation').selectOption('tapes');await f('Tape velocity').fill('97');
  await f('Tape MIDI roots (comma separated)').fill('60, 61');await f('Instrument or export folder name').fill('Bells tapes');
  await press('Review conversion');await f('Accept the reported conversion losses').check();
  await press('Write reviewed conversion…');assert.match(await status.innerText(),/Bells tapes/);
  await f('Interchange operation').selectOption('import');
  await page.evaluate(async()=>{
    const dir=await(await pick('sampler-sfz-export')).getDirectoryHandle('Bells interchange');
    const original=window.showDirectoryPicker;
    window.showDirectoryPicker=async opts=>opts.id==='sampler-sfz-source'?dir:original(opts);
  });
  await press('Choose SFZ source folder…');await f('Instrument or export folder name').fill('Imported bells');
  await press('Review conversion');
  if(await f('Accept the reported conversion losses').isVisible())await f('Accept the reported conversion losses').check();
  await press('Write reviewed conversion…');assert.match(await status.innerText(),/SFZ imported/);
  const query=studio.getByLabel('Search sampler library');
  await query.fill('Recovered tap');await query.press('Enter');await idle();
  await press('Recovered tap',studio);
  await open('Sample metadata');await press('Inspect sample metadata');
  await f('Sample title').fill('Bright tap');await f('Sample tags (comma separated)').fill('metal');
  await f('Sample license').fill('CC0');await press('Save sample metadata');
  assert.match(await status.innerText(),/metadata saved/i);
  const result=await page.evaluate(async()=>{
    const {inspect,inspectSample,verify,search,readLibrary}=await import('./sampler-library.js');
    const {preparePair}=await import('./mellotron-library.js');
    const root=await pick('waswan-samples'), old=await verify(root,audit.ref);
    const recent=await inspect(root,audit.ref,{latest:true}), good=await verify(root,recent.ref);
    const portable=await pick('sampler-collect');
    const collected=await verify(portable,{...audit.ref,revision:2,libraryId:(await readLibrary(portable)).id});
    const returned=(await search(root,{kind:'instrument',text:'Imported bells'})).items[0];
    const tape=await preparePair(await pick('sampler-tapes-export'),['Bells tapes','Bells tapes']);
    const edited=await inspectSample(root,'Samples/Originals/Recovered/tap.wav',{verify:true});
    return {oldOk:old.ok,revision:good.ref.revision,ok:good.ok,tags:recent.instrument.tags,
      metadata:[edited.name,edited.tags,edited.license,edited.sha256===recent.instrument.samples[0].sha256],
      collected:collected.ok,sfz:returned.displayName,tapes:tape.regions.filter(r=>r.bank===0).map(r=>r.root)};
  });
  assert.deepEqual(result,{oldOk:false,revision:3,ok:true,tags:['metal','percussion'],collected:true,
    sfz:'Imported bells',metadata:['Bright tap',['metal'],'CC0',true],tapes:[60,61]});
  assert.deepEqual(errors,[]);
  await writeFile(evidence+'/interchange-browser.json',JSON.stringify(result,null,2));
  console.log('PASS Chromium UI repair of two missing assets, permission rejection, portable collection, metadata revisions, reviewed SFZ and playable tape round-trip');
}finally{await browser.close();}
