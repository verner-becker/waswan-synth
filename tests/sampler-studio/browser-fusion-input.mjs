// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';

const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome'});
try {
  const page = await browser.newPage({viewport:{width:1380,height:820}});
  await page.addInitScript(() => {
    window.audit = {sent:[],fusion:[]};
    audit.device={id:'isolated-midi',name:'Test MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.device.id,audit.device]])});
    const Original=AudioWorkletNode;
    window.AudioWorkletNode=class extends Original {
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        const send=this.port.postMessage.bind(this.port);
        this.port.postMessage=(msg,...rest)=>{audit.sent.push(msg);send(msg,...rest);};
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
  });
  await page.goto(process.env.SAMPLER_BROWSER_URL || 'http://localhost:8737/simulator/');
  await page.locator('.ww-shell').waitFor();
  await page.evaluate(async()=>{
    const loaded=performance.getEntriesByType('resource').find(entry=>/\/midi\.js(?:\?|$)/.test(entry.name));
    const {MidiInputController}=await import(loaded.name);
    const message=MidiInputController.prototype.message;
    MidiInputController.prototype.message=function(...args){audit.controller=this;return message.apply(this,args);};
  });
  await startSynth(page,{connect:true});
  const midi=(...data)=>page.evaluate(data=>audit.device.onmidimessage({data,timeStamp:performance.now()}),data);
  await midi(0x90,60,80);await midi(0x80,60,0);
  await page.evaluate(async()=>{
    const {createFusionInput}=await import('./sampler-fusion-input.js');
    audit.input=audit.controller.fusionInput??=createFusionInput();
    audit.lease={async note(value){audit.fusion.push(['note',value]);},async pedal(value){audit.fusion.push(['pedal',value]);},
      async releaseOwner(owner,channel){audit.fusion.push(['release',{owner,channel}]);}};
    audit.input.bind(audit.lease);
    document.body.tabIndex=-1; document.body.focus();
    audit.sent=[];
  });
  await midi(0x92,48,112);await midi(0xb2,64,127);
  const key = page.locator('#keys [data-key="0"]');
  await key.scrollIntoViewIfNeeded();
  const bounds = await key.boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.4,bounds.y+bounds.height*.8);
  await page.mouse.down();
  await page.keyboard.down('a');
  let commands = await page.evaluate(()=>audit.fusion);
  for(const owner of ['midi:isolated-midi','screen','computer']){
    assert(commands.some(([type,v])=>type==='note'&&v.owner===owner&&v.note===48&&v.velocity>0));
  }
  assert(commands.some(([type,v])=>type==='pedal'&&v.channel===2&&v.down));
  assert(await key.evaluate(k=>k.classList.contains('midi-down')));
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('a'); await page.mouse.up();
  commands=await page.evaluate(()=>audit.fusion);
  assert(commands.some(([type,v])=>type==='release'&&v.owner==='screen'));
  assert(commands.some(([type,v])=>type==='release'&&v.owner==='computer'));
  assert(!commands.some(([type,v])=>type==='release'&&v.owner.startsWith('midi:')));
  await midi(0x82,48,0);
  assert(!await key.evaluate(k=>k.classList.contains('midi-down')));
  await midi(0x92,49,120);
  await page.evaluate(()=>audit.input.unbind(audit.lease));
  await midi(0x82,49,0);await midi(0xb2,64,0);
  const leaked = await page.evaluate(()=>audit.sent.filter(m=>['key','midi','panic'].includes(m.t)));
  assert.deepEqual(leaked,[],'late note and pedal releases after Stop must not reach restored Synth');
  await midi(0x92,50,118);await midi(0x82,50,0);
  assert.deepEqual(await page.evaluate(()=>audit.sent.filter(m=>m.t==='midi').map(m=>m.d1)),[50,50]);
  await page.evaluate(()=>{audit.input.bind(audit.lease);audit.sent=[];audit.fusion=[];});
  await midi(0x92,48,110);
  await page.evaluate(()=>audit.controller.select('','disconnected'));
  assert(!await key.evaluate(k=>k.classList.contains('midi-down')));
  assert.deepEqual(await page.evaluate(()=>audit.fusion.at(-1)),['release',{owner:'midi:isolated-midi',channel:undefined}]);
  assert(!await page.evaluate(()=>audit.sent.some(m=>m.t==='panic')));
  console.log('PASS original keyboard, pointer and Web MIDI mapped to separate owners, browser blur preserves external hold, pedal and stale releases, native route restored and disconnect avoids global panic');
} finally { await browser.close(); }
