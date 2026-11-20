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
        super(...args);audit.post=m=>this.port.postMessage(m);this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
    const Context=window.AudioContext;
    window.AudioContext=class extends Context {
      constructor(...a){super(...a);audit.contexts++;}
      createAnalyser(){const analyser=super.createAnalyser();audit.master??=analyser;return analyser;}
    };
    window.showDirectoryPicker=()=>navigator.storage.getDirectory();
  });
  await page.goto('http://localhost:8737/simulator/');
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.locator('.ww-midi-continue').click();
  await page.locator('.ww-tapes > summary').click();
  return {context,page};
}
let {context,page}=await open();
const instrument=()=>page.getByRole('combobox',{name:'Instrument',exact:true});
const layer=()=>page.getByRole('combobox',{name:'Layer',exact:true});
async function playing(sound){
  await page.waitForFunction(sound=>document.querySelector('.ww-tape-status').textContent===sound+' · playing on Part A'&&
    !document.querySelector('.ww-tape-actions').disabled,sound);
}
async function harmonicRatio(){
  await instrument().focus();
  await page.keyboard.down('a');
  try{
    const ratio=await page.waitForFunction(()=>{
      const voice=audit.frame.polyphony.slots.find(v=>v.gate);
      if(!voice)return false;
      const analyser=audit.master;
      analyser.fftSize=8192;
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
      if(Math.max(...samples.subarray(0,2048).map(Math.abs))<.003)return false;
      const hz=220*2**((voice.note-60)/12);
      function magnitude(harmonic){
        let re=0,im=0;
        for(let i=0;i<samples.length;i++){
          const phase=2*Math.PI*hz*harmonic*i/analyser.context.sampleRate;
          const value=samples[i]*(1-Math.cos(2*Math.PI*i/samples.length));
          re+=value*Math.cos(phase);im+=value*Math.sin(phase);
        }
        return Math.hypot(re,im);
      }
      const fundamental=magnitude(1);
      return fundamental>15&&{ratio:magnitude(2)/fundamental};
    });
    return (await ratio.jsonValue()).ratio;
  }finally{
    await page.keyboard.up('a');
    await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
  }
}
try{
  await instrument().selectOption('Rehearsal flute');await playing('Rehearsal flute');
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
  await page.locator('.ww-tapes summary').filter({hasText:'Tape settings and library'}).click();
  await page.getByRole('button',{name:'Open tape folder'}).click();
  await instrument().selectOption('Flute');await playing('Flute');
  assert.equal(await layer().inputValue(),'');
  const flute=await harmonicRatio();
  await auditHeldSwitch();
  const strings=await harmonicRatio();
  assert(strings>flute+.15,JSON.stringify({flute,strings}));
  console.log('Keyboard audition harmonic ratios',{flute,strings});
  await instrument().selectOption('Flute');
  await layer().selectOption('Strings');await playing('Flute + Strings');
  const mix=page.getByLabel('Layer mix (%)',{exact:true});
  await mix.fill('27');await mix.press('Tab');
  await page.waitForFunction(async()=>{
    const {librarySetting}=await import('/simulator/tone-bank.js');
    return (await librarySetting(undefined,'mellotron'))?.settings.mix===27;
  });
  await page.getByRole('button',{name:'Use Synth on Part A'}).click();
  await page.getByText('Synth on Part A',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Play selection'}).click();await playing('Flute + Strings');
  await mix.fill('50');await mix.press('Tab');
  await page.waitForFunction(async()=>{
    const {librarySetting}=await import('/simulator/tone-bank.js');
    return (await librarySetting(undefined,'mellotron'))?.settings.mix===50;
  });
  await context.close();
  ({context,page}=await open());
  assert.equal(await instrument().inputValue(),'Flute');
  assert.equal(await layer().inputValue(),'Strings');
  await page.getByRole('button',{name:'Play selection'}).click();await playing('Flute + Strings');
  await page.locator('[data-workspace="daw"]').first().click();
  await checkCapture(page,context.browser(),directory,errors,true);
}catch(error){
  console.error(await page.locator('.ww-tapes [role=status]').allTextContents(),errors);
  throw error;
}finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}

async function auditHeldSwitch(){
  await page.evaluate(()=>audit.post({t:'midi',st:144,d1:60,d2:100}));
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate));
  await instrument().selectOption('Strings');
  await page.getByText(/Release keys and sustain/).waitFor();
  assert.equal(await page.locator('.ww-tape-status').textContent(),'Flute · playing on Part A');
  await page.evaluate(()=>audit.post({t:'midi',st:128,d1:60,d2:0}));
  await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.active));
  await page.getByRole('button',{name:'Play selection'}).click();await playing('Strings');
}
