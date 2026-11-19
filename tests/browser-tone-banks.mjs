// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from './browser-foundation-controls.mjs';

const evidence='.local/validation/tone-bank-workflow';
fs.mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.audit={};
    window.showDirectoryPicker=async()=>{
      const root=await navigator.storage.getDirectory();
      return root.getDirectoryHandle(window.testBank||'Test bank',{create:true});
    };
    if(location.search.includes('file-only'))window.showDirectoryPicker=undefined;
    const Audio=window.AudioContext;
    window.AudioContext=class extends Audio{
      createAnalyser(){
        const analyser=super.createAnalyser();
        audit.analyser??=analyser;
        return analyser;
      }
    };
    const Worklet=window.AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet{
      constructor(...args){
        super(...args);
        audit.post=message=>this.port.postMessage(message);
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
  });
  await page.goto('http://localhost:8737/simulator/');
  await startSynth(page);
  await page.locator('[data-workspace="tones"]').click();
  const original=await page.evaluate(()=>audit.frame.editor.targets);
  await page.getByRole('button',{name:'+ Add FM',exact:true}).click();
  const fm=page.locator('.ww-fm-panel');
  await fm.getByLabel('FM level',{exact:true}).fill('82');
  await fm.getByLabel('FM level',{exact:true}).press('Tab');
  await page.waitForFunction(()=>audit.frame.fm?.bytes[4]===82);
  const banks=page.getByRole('combobox',{name:'Tone bank',exact:true});
  const tones=page.getByRole('combobox',{name:'Folder tone',exact:true});
  const open=()=>banks.selectOption('manage');
  await page.getByRole('button',{name:'Save to bank…'}).click();
  const bank=page.getByRole('dialog',{name:'Tone banks'});
  await bank.getByRole('button',{name:'Choose library folder…'}).click();
  await bank.getByText('Folder “Test bank” · 0 tones').waitFor();
  assert(await bank.getByLabel('New tone name').inputValue());
  await bank.getByLabel('New tone name').fill(' ');
  assert(await bank.getByRole('button',{name:'Create tone file'}).isDisabled());
  await bank.getByLabel('New tone name').fill('Baixo híbrido');
  await bank.getByRole('button',{name:'Create tone file'}).click();
  await bank.getByText('Saved “Baixo híbrido” to disk.').waitFor();
  await bank.getByRole('button',{name:'Close',exact:true}).click();
  await fm.getByLabel('FM level',{exact:true}).fill('12');
  await fm.getByLabel('FM level',{exact:true}).press('Tab');
  await page.waitForFunction(()=>audit.frame.fm?.bytes[4]===12);
  const chorus=await page.evaluate(()=>{
    const value=(audit.frame.editor.values[52].value+5)%128;
    audit.post({t:'editor-set',id:52,value,scope:audit.frame.instrument.scope});
    return value;
  });
  await page.waitForFunction(value=>audit.frame.editor.values[52].value===value,chorus);
  await page.locator('[data-workspace="perf"]').click();
  await open();
  await bank.getByLabel('Find a tone').fill('missing');
  assert(await bank.getByRole('button',{name:'Load into Part A'}).isDisabled());
  await bank.getByLabel('Find a tone').fill('híbr');
  assert.equal(await bank.getByLabel('Bank tone').locator('option:checked').textContent(),'Baixo híbrido');
  page.once('dialog',dialog=>dialog.dismiss());
  await bank.getByRole('button',{name:'Load into Part A',exact:true}).click();
  assert.equal(await page.evaluate(()=>audit.frame.fm.bytes[4]),12);
  await page.evaluate(()=>audit.post({t:'midi',st:144,d1:60,d2:100}));
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(voice=>voice.gate));
  page.once('dialog',dialog=>dialog.accept());
  await bank.getByRole('button',{name:'Load into Part A',exact:true}).click();
  await bank.getByText('Stop playback and let the selected part fall silent before loading.').waitFor();
  assert.equal(await page.evaluate(()=>audit.frame.fm.bytes[4]),12);
  await page.evaluate(()=>audit.post({t:'midi',st:128,d1:60,d2:0}));
  await page.waitForFunction(()=>audit.frame.polyphony.slots.every(voice=>!voice.active));
  page.once('dialog',dialog=>dialog.accept());
  await bank.getByRole('button',{name:'Load into Part A',exact:true}).click();
  await bank.waitFor({state:'hidden'});
  await page.waitForFunction(()=>audit.frame.fm?.bytes[4]===82);
  await page.getByText('Bank tone · Baixo híbrido · Program',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>audit.frame.editor.values[52].value),chorus);
  const files=await page.evaluate(async()=>{
    const folder=await showDirectoryPicker();
    const files=[];
    for await(const handle of folder.values())files.push({name:handle.name,text:await(await handle.getFile()).text()});
    const invalid=await folder.getFileHandle('invalid.wstone',{create:true});
    const writer=await invalid.createWritable();
    await writer.write('{}');
    await writer.close();
    return files;
  });
  assert.equal(files.length,1);
  assert(files[0].name.endsWith('.wstone'));
  const tone=JSON.parse(files[0].text);
  assert.equal(tone.name,'Baixo híbrido');
  assert.equal(tone.patch.length,169);
  assert.deepEqual(await page.evaluate(()=>audit.frame.editor.targets),original);
  await open();
  await bank.getByRole('button',{name:'Refresh folder'}).click();
  await bank.getByText('Skipped 1 unreadable or invalid tone file.').waitFor();
  await bank.locator('input[type=file]').setInputFiles({name:'download.wstone',mimeType:'application/json',buffer:Buffer.from(files[0].text)});
  await bank.getByText('Tone file opened. Load it into the selected part to play it.').waitFor();
  assert.equal(await bank.getByLabel('Bank tone').locator('option:checked').textContent(),'Baixo híbrido · opened file');
  page.once('dialog',dialog=>dialog.accept());
  await bank.getByRole('button',{name:'Load into Part A',exact:true}).click();
  await bank.waitFor({state:'hidden'});
  await open();
  await bank.getByRole('button',{name:'Create bank tone'}).click();
  await bank.getByLabel('New tone name').fill('Baixo híbrido');
  await page.screenshot({path:evidence+'/create-desktop.png'});
  await bank.getByRole('button',{name:'Create tone file'}).click();
  await bank.getByText('Folder “Test bank” · 2 tones').waitFor();
  const chosen=await bank.getByLabel('Bank tone').locator('option:checked').textContent();
  assert.match(chosen,/ · #2 · /);
  await bank.getByRole('button',{name:'Refresh folder'}).click();
  await bank.getByText('Skipped 1 unreadable or invalid tone file.',{exact:true}).waitFor();
  assert.equal(await bank.getByLabel('Bank tone').locator('option:checked').textContent(),chosen);
  await page.setViewportSize({width:390,height:844});
  assert(await bank.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await page.screenshot({path:evidence+'/mobile.png'});
  await page.keyboard.press('Escape');
  // Configure one library with named subfolders and independent tone files.
  await page.evaluate(async text=>{
    window.testBank='My banks';
    const root=await showDirectoryPicker();
    for(const [name,tone] of [['DX7','Electric Piano'],['Poly-D','Bass']]){
      const folder=await root.getDirectoryHandle(name,{create:true});
      const file=await folder.getFileHandle('sample.wstone',{create:true});
      const writer=await file.createWritable();
      await writer.write(JSON.stringify({...JSON.parse(text),name:tone}));
      await writer.close();
    }
  },files[0].text);
  await banks.selectOption('choose');
  await tones.getByRole('option',{name:'Electric Piano'}).waitFor({state:'attached'});
  await banks.selectOption({label:'Poly-D'});
  await tones.getByRole('option',{name:'Bass'}).waitFor({state:'attached'});
  await page.reload();
  await startSynth(page);
  assert.equal(await banks.inputValue(),'internal');
  const internal=page.getByRole('combobox',{name:'Tone program'});
  const initial=Number(await internal.inputValue());
  const referenceSlot=initial===1?2:1;
  await internal.selectOption(String(referenceSlot));
  if(await page.locator('.ww-tone-confirm').isVisible())await page.getByRole('button',{name:'Discard and load'}).click();
  await page.waitForFunction(slot=>audit.frame.programs[audit.frame.track]===slot,referenceSlot);
  // Measure the post-master output and require a newly gated voice: an FX tail
  // by itself must not pass as a playable key.
  async function playNote(down,up){
    await down();
    try{
      const peak=await page.waitForFunction(()=>{
        if(!audit.frame.polyphony.slots.some(voice=>voice.gate))return false;
        const samples=new Float32Array(audit.analyser.fftSize);
        audit.analyser.getFloatTimeDomainData(samples);
        const peak=Math.max(...samples.map(Math.abs));
        return peak>.001&&peak;
      },null,{timeout:4000});
      return await peak.jsonValue();
    }finally{
      await up();
      await page.waitForFunction(()=>audit.frame.polyphony.slots.every(voice=>!voice.active));
    }
  }
  const playKey=()=>playNote(()=>page.keyboard.down('a'),()=>page.keyboard.up('a'));
  const playMidi=()=>playNote(
    ()=>page.evaluate(()=>audit.post({t:'midi',st:144,d1:60,d2:100})),
    ()=>page.evaluate(()=>audit.post({t:'midi',st:128,d1:60,d2:0})));
  await internal.focus();
  const audioPeaks={internal:await playKey()};
  const playing=await page.evaluate(()=>audit.frame.instrument.programToken);
  await page.evaluate(()=>{
    const original=FileSystemHandle.prototype.requestPermission;
    FileSystemHandle.prototype.requestPermission=function(options){
      FileSystemHandle.prototype.requestPermission=original;
      return Promise.resolve('denied');
    };
  });
  await banks.selectOption({label:'DX7'});
  await page.getByText('Folder access denied.',{exact:false}).waitFor();
  assert.equal(await banks.inputValue(),'internal');
  await banks.selectOption({label:'DX7'});
  await tones.getByRole('option',{name:'Electric Piano'}).waitFor({state:'attached'});
  assert.equal(await page.evaluate(()=>audit.frame.instrument.programToken),playing);
  if(await page.evaluate(()=>audit.frame.instrument.edited))page.once('dialog',dialog=>dialog.accept());
  await tones.selectOption({label:'Electric Piano'});
  await page.getByText('Bank tone · Electric Piano · Program',{exact:false}).waitFor();
  await tones.focus();
  audioPeaks.folder=await playKey();
  await page.locator('.ww-topbar').scrollIntoViewIfNeeded();
  await page.screenshot({path:evidence+'/bank-tone-combos.png'});
  await page.locator('[data-workspace="tones"]').click();
  await page.getByRole('button',{name:'Save to bank…'}).click();
  const newName=bank.getByLabel('New tone name');
  await newName.fill('');
  await newName.pressSequentially('sad');
  assert.equal(await newName.inputValue(),'sad');
  assert(await page.evaluate(()=>audit.frame.polyphony.slots.every(voice=>!voice.gate)));
  await newName.fill('Electric Piano soft');
  await bank.getByRole('button',{name:'Create tone file'}).click();
  await bank.getByText('Saved “Electric Piano soft” to disk.').waitFor();
  await bank.getByRole('button',{name:'Close',exact:true}).click();
  assert(await tones.getByRole('option',{name:'Electric Piano soft'}).count());
  await banks.selectOption('internal');
  const program=await page.evaluate(()=>audit.frame.programs[audit.frame.track]);
  await page.getByRole('combobox',{name:'Tone program'}).selectOption(String(program));
  await page.getByRole('button',{name:'Discard and load'}).click();
  await page.waitForFunction(()=>!audit.frame.instrument.edited);
  assert.equal(await page.evaluate(()=>audit.frame.instrument.programToken),playing);
  // Play immediately after confirming. The dialog returns focus to Tone.
  assert(await internal.evaluate(node=>document.activeElement===node));
  audioPeaks.restored=await playKey();
  audioPeaks.midi=await playMidi();
  await banks.focus();
  audioPeaks.bankFocused=await playKey();
  assert.equal(await banks.inputValue(),'internal');
  assert.equal(await internal.inputValue(),String(program));
  await internal.press('ArrowDown');
  await page.waitForFunction(value=>audit.frame.programs[audit.frame.track]===value,program+1);
  console.log('Post-master peaks',audioPeaks);
  await open();
  await page.evaluate(()=>{window.testBank='Second bank';});
  await bank.getByRole('button',{name:'Choose library folder…'}).click();
  await bank.getByText('Folder “Second bank” · 0 tones').waitFor();
  assert(await bank.getByRole('button',{name:'Load into Part A',exact:true}).isDisabled());
  await page.keyboard.press('Escape');
  await page.goto('http://localhost:8737/simulator/?file-only');
  await startSynth(page);
  await page.evaluate(()=>audit.post({t:'enc',e:5,steps:1}));
  await page.waitForFunction(()=>audit.frame.track===1);
  await open();
  assert(await bank.getByText('Folder access unavailable in this browser').isVisible());
  assert(await bank.getByRole('button',{name:'Create bank tone'}).isDisabled());
  await bank.locator('input[type=file]').setInputFiles({name:'portable.wstone',mimeType:'application/json',buffer:Buffer.from(files[0].text)});
  await bank.getByText('Tone file opened. Load it into the selected part to play it.').waitFor();
  page.once('dialog',dialog=>dialog.accept());
  await bank.getByRole('button',{name:'Load into Part B',exact:true}).click();
  await bank.waitFor({state:'hidden'});
  await page.waitForFunction(()=>audit.frame.track===1&&audit.frame.fm?.bytes[4]===82);
  await page.evaluate(()=>audit.post({t:'fm-set',scope:audit.frame.instrument.scope,field:4,value:32}));
  await page.getByText('Last file loaded · Baixo híbrido · Program',{exact:false}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: Bank and Tone selectors, remembered library after reload, read permission retry, subfolder writes, internal slot restore, FM round-trip, held notes and mobile layout');
}finally{await browser.close();}
