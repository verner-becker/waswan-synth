// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeFixture} from './mellotron-a/fixture.mjs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';

const profile=fs.mkdtempSync(path.join(os.tmpdir(),'waswan-library-folders-'));
const options={executablePath:'/usr/bin/google-chrome',headless:true};
let context,page;
const errors=[];
async function open(prompt=false){
  context=await chromium.launchPersistentContext(profile,options);
  page=context.pages()[0];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(prompt=>{
    window.picks=window.prompts=0;
    const dirs={'waswan-tone-banks':'My tones','waswan-tapes':'My tapes','waswan-samples':'My samples'};
    window.showDirectoryPicker=async({id})=>{
      window.picks++;
      return (await navigator.storage.getDirectory()).getDirectoryHandle(dirs[id],{create:true});
    };
    if(prompt){
      const original=FileSystemHandle.prototype.queryPermission;
      FileSystemHandle.prototype.queryPermission=function(options){
        return ['My tapes','CHOIR'].includes(this.name)&&!window.allowed?Promise.resolve('prompt'):original.call(this,options);
      };
      FileSystemHandle.prototype.requestPermission=async function(){
        window.prompts++;
        return window.allowed?'granted':'denied';
      };
    }
  },prompt);
  await page.goto('http://localhost:8737/simulator/');
}
async function setup(){
  await page.getByRole('button',{name:'Instrument setup',exact:true}).click();
  const panel=page.locator('.ww-library-folders');
  if(!await panel.evaluate(n=>n.open))await panel.locator('summary').click();
  return panel;
}
try{
  await open();
  await page.evaluate(async tone=>{
    const root=await navigator.storage.getDirectory();
    const tones=await root.getDirectoryHandle('My tones',{create:true});
    const dx=await tones.getDirectoryHandle('DX7',{create:true});
    const writer=await(await dx.getFileHandle('Bass.wstone',{create:true})).createWritable();
    await writer.write(tone);await writer.close();
    const tapes=await root.getDirectoryHandle('My tapes',{create:true});
    for(const bank of ['Flute','Cello'])await tapes.getDirectoryHandle(bank,{create:true});
  },fs.readFileSync('banks/DX7 - Aquanode/28-SBass2.wstone','utf8'));
  const labels=['Tone banks','Mellotron tapes','Samples'];
  let panel=await setup();
  for(const label of labels){
    const row=panel.getByRole('group',{name:label,exact:true});
    await row.getByRole('button',{name:'Choose folder…'}).click();
    await row.getByRole('button',{name:'Refresh folder'}).waitFor();
  }
  assert.equal(await page.evaluate(()=>window.picks),3);
  // Simulate adding a bank while the synth is closed, before restoring its settings.
  await page.evaluate(async()=>{
    const root=await navigator.storage.getDirectory();
    const tones=await root.getDirectoryHandle('My tones');
    await tones.getDirectoryHandle('New analog bank',{create:true});
  });
  await context.close();
  await open(true);
  panel=await setup();
  await panel.getByText('My tones',{exact:true}).waitFor();
  await panel.getByText('My samples',{exact:true}).waitFor();
  const tape=panel.getByRole('group',{name:'Mellotron tapes'});
  await tape.getByText('My tapes · access required',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>[picks,prompts]),[0,0]);
  await tape.getByRole('button',{name:'Allow access'}).click();
  await tape.getByText(/Access denied/).waitFor();
  await page.evaluate(()=>{window.allowed=true;});
  await tape.getByRole('button',{name:'Allow access'}).click();
  await tape.getByRole('button',{name:'Refresh folder'}).waitFor();
  await page.locator('[data-workspace="tones"]').first().click();
  const bank=page.getByLabel('Tone bank',{exact:true});
  await bank.getByRole('option',{name:'New analog bank'}).waitFor({state:'attached'});
  await bank.selectOption({label:'DX7'});
  await page.getByLabel('Folder tone',{exact:true}).getByRole('option',{name:'SBass2',exact:true}).waitFor({state:'attached'});
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.locator('.ww-midi-continue').click();
  await page.locator('.ww-tone-editor .ww-tapes > summary').click();
  assert.deepEqual(await page.getByLabel('Instrument',{exact:true}).locator('option').allTextContents(),['Choose an instrument…','Cello','Flute']);
  assert.equal(await page.evaluate(()=>picks),0);
  // Reopen the format used by milestone B with the order the player last loaded.
  await page.evaluate(async()=>{
    const {librarySetting}=await import('/simulator/tone-bank.js');
    const {folder,names}=await librarySetting(undefined,'tapeLibrary');
    await librarySetting({folder,names,banks:['Flute','Cello']},'mellotron');
    const db=await new Promise(resolve=>{
      const req=indexedDB.open('waswan-tone-library');
      req.onsuccess=()=>resolve(req.result);
    });
    await new Promise(resolve=>{
      const tx=db.transaction('settings','readwrite');
      tx.objectStore('settings').delete('tapeLibrary');tx.oncomplete=resolve;
    });
    db.close();
  });
  await page.reload();
  panel=await setup();
  await panel.getByText('My tapes · access required',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Instrument',{exact:true}).inputValue(),'Flute');
  assert.equal(await page.getByLabel('Layer',{exact:true}).inputValue(),'Cello');
  assert.deepEqual(await page.evaluate(()=>[picks,prompts]),[0,0]);
  // Older versions saved an empty list when the musician picked CHOIR itself.
  await page.evaluate(async base64=>{
    const {librarySetting}=await import('/simulator/tone-bank.js');
    const library=await(await navigator.storage.getDirectory()).getDirectoryHandle('My tapes');
    const folder=await library.getDirectoryHandle('CHOIR',{create:true});
    const writer=await(await folder.getFileHandle('60 CHOIR.wav',{create:true})).createWritable();
    await writer.write(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));await writer.close();
    await librarySetting({folder,names:[],id:crypto.randomUUID()},'tapeLibrary');
  },writeFixture().toString('base64'));
  await context.close();await open(true);
  const tapes=page.locator('.ww-tapes');
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.locator('.ww-midi-continue').click();
  await tapes.locator(':scope > summary').click();
  const allow=tapes.getByRole('button',{name:'Allow folder access'});
  await allow.click();
  await tapes.getByText('Allow access to the tape folder to read its instruments.').waitFor();
  await page.evaluate(()=>{window.allowed=true;});
  await allow.click();
  await tapes.getByText('Instrument folder · CHOIR').waitFor();
  assert.deepEqual(await page.evaluate(()=>[picks,prompts]),[0,2]);
  assert.equal(await tapes.getByLabel('Instrument',{exact:true}).inputValue(),'CHOIR');
  await tapes.getByRole('button',{name:'Play selection'}).click();
  await tapes.getByText('CHOIR · playing on Part A').waitFor();
  assert(await tapes.getByLabel('Layer',{exact:true}).isDisabled());
  await tapes.getByRole('button',{name:'Open library folder…'}).click();
  const instruments=tapes.getByLabel('Instrument',{exact:true});
  await instruments.getByRole('option',{name:'Flute',exact:true}).waitFor({state:'attached'});
  assert.deepEqual(await instruments.locator('option').allTextContents(),['Choose an instrument…','CHOIR','Cello','Flute']);
  assert.deepEqual(errors,[]);
  console.log('PASS three folders survive a Chrome restart, disk changes visible in TONES, permission retry, no picker on restore');
}finally{
  await context?.close();
  fs.rmSync(profile,{recursive:true,force:true});
}
