// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {writeFixture} from '../mellotron-a/fixture.mjs';
import {checkCapture} from '../mellotron-capture.mjs';

const directory='.local/validation/mellotron-b';
fs.mkdirSync(directory,{recursive:true});
const options={executablePath:'/usr/bin/google-chrome',headless:true,viewport:{width:1600,height:1100}};
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'waswan-tape-check-'));
const errors=[];
async function open(){
  const context=await chromium.launchPersistentContext(profile,options);
  const page=context.pages()[0];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.audit={contexts:0};
    audit.source={id:'tape-smk',name:'Tape test keyboard',state:'connected',async open(){},async close(){}};
    audit.access={inputs:new Map([[audit.source.id,audit.source]])};
    navigator.requestMIDIAccess=async()=>audit.access;
    const Node=AudioWorkletNode;
    window.AudioWorkletNode=class extends Node{
      constructor(...args){
        super(...args);this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
    const Context=window.AudioContext;
    window.AudioContext=class extends Context {constructor(...a){super(...a);audit.contexts++;}};
    window.showDirectoryPicker=()=>navigator.storage.getDirectory();
  });
  await page.goto('http://localhost:8737/simulator/');
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.locator('.ww-midi-continue').click();
  await page.locator('.ww-tapes summary').click();
  return {context,page};
}
let {context,page}=await open();
async function load(){
  await page.getByRole('button',{name:'Load both banks'}).click();
  await page.waitForFunction(()=>document.querySelector('.ww-tapes [role=status]').textContent.includes('playing on Part A'));
}
try{
  await load();
  await page.locator('.ww-topbar').getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('#midiConnect').click();
  await page.waitForFunction(()=>!!audit.source.onmidimessage);
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await page.evaluate(()=>audit.source.onmidimessage({data:[144,60,100]}));
  await page.waitForFunction(()=>audit.frame?.polyphony.slots.some(v=>v.gate));
  await page.locator('[data-workspace="tones"]').first().click();
  assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate)));
  await page.evaluate(()=>{audit.source.state='disconnected';audit.access.onstatechange();});
  await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
  await page.locator('[data-workspace="perf"]').first().click();
  await page.locator('.ww-tapes').screenshot({path:directory+'/performance.png'});
  // Real directory handles under an isolated test origin stand in for Chrome's
  // native picker. Bank B includes an overtone that distinguishes the mix.
  await page.evaluate(async base64=>{
    const bytes=Uint8Array.from(atob(base64),s=>s.charCodeAt(0));
    const root=await navigator.storage.getDirectory();
    for(const name of ['Flute','Strings']){
      if(name==='Strings'){
        const pcm=new Int16Array(bytes.buffer,44);
        for(let i=0;i<pcm.length;i++)pcm[i]+=Math.round(4000*Math.sin(2*Math.PI*440*i/44100));
      }
      const dir=await root.getDirectoryHandle(name,{create:true});
      const handle=await dir.getFileHandle('60 Test.wav',{create:true});
      const writer=await handle.createWritable();await writer.write(bytes);await writer.close();
    }
  },writeFixture().toString('base64'));
  await page.getByRole('button',{name:'Open tape folder'}).click();
  await load();
  await page.locator('.ww-tapes button:enabled').first().waitFor();
  await context.close();
  ({context,page}=await open());
  await page.waitForFunction(()=>document.querySelector('.ww-tapes [role=status]').textContent.includes('last selection'));
  assert.equal(await page.getByLabel('Bank A',{exact:true}).inputValue(),'Flute');
  assert.equal(await page.getByLabel('Bank B',{exact:true}).inputValue(),'Strings');
  await load();
  await page.locator('[data-workspace="daw"]').first().click();
  await checkCapture(page,context.browser(),directory,errors,true);
}catch(error){
  console.error(await page.locator('.ww-tapes [role=status]').textContent().catch(()=>''),errors);
  throw error;
}finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
