// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/daw-mvp-wave-8';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1366,height:920}}),errors=[];
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
  await page.addInitScript(()=>{
    window.audit={contexts:0,commands:[]};
    const id=localStorage.getItem('test-midi-id')||'id-a';
    const port=(id,name,manufacturer)=>({id,name,manufacturer,state:'connected',async open(){},async close(){}});
    audit.source=port(id,'SMK Test','M-VAVE');
    audit.other=port('id-other','MiniLab Test','Arturia');
    audit.access={inputs:new Map([[id,audit.source],[audit.other.id,audit.other]])};
    navigator.requestMIDIAccess=async()=>audit.access;
    const Context=AudioContext;
    window.AudioContext=class extends Context{constructor(...args){super(...args);audit.context=this;audit.contexts++;}};
    const Node=AudioWorkletNode;
    window.AudioWorkletNode=class extends Node{
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});
        const send=this.port.postMessage.bind(this.port);
        this.port.postMessage=(m,...transfer)=>{audit.commands.push(m);return send(m,...transfer);};
      }
    };
  });
  const url='http://localhost:8737/simulator/?workspace=daw';
  const daw=page.locator('.ww-daw');
  const button=name=>daw.getByRole('button',{name,exact:true});
  const field=name=>daw.getByLabel(name,{exact:true});
  const setup=page.locator('.ww-midi-setup');
  const midi=async data=>page.evaluate(data=>audit.source.onmidimessage({data,timeStamp:performance.now()}),data);
  const profile=daw.locator('.ww-daw-midi-profiles');
  const menu=daw.locator('.ww-daw-view-menu');
  async function detach(name){
    await menu.locator('summary').click();
    const open=page.waitForEvent('popup');
    await menu.getByRole('button',{name:'Detach '+name,exact:true}).click();
    const popup=await open;
    popup.on('pageerror',error=>errors.push(error.message));
    await popup.locator('.ww-daw-detached').waitFor();
    return popup;
  }

  await page.goto(url);
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.waitForFunction(()=>audit.frame?.ms>5000);
  await setup.getByRole('button',{name:'Connect MIDI keyboard',exact:true}).click();
  await page.locator('#midiInput').selectOption('id-a');
  await page.waitForFunction(()=>!!audit.source.onmidimessage);
  await setup.locator('.ww-midi-continue').click();
  await page.evaluate(async()=>{
    const {DawMix}=await import('/simulator/ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.w=this.w;return refresh.apply(this,args);};
  });
  await button('Add MIDI track').click();
  await button('Show Clip editor').click();
  await daw.getByText('Exact note values',{exact:true}).click();
  await button('Add DAW note').click();
  await button('Show Browser').click();
  await profile.locator('summary').click();
  await profile.getByLabel('Profile name',{exact:true}).fill('My controller');
  await profile.getByRole('button',{name:'Create profile for this device'}).click();
  await profile.getByLabel('Enable contextual profiles').check();
  await profile.getByLabel('MIDI context').selectOption('performance');
  await profile.getByLabel('Context control').selectOption('synth:0');
  await profile.getByRole('button',{name:'Learn context control'}).click();
  await midi([176,48,20]);
  const current=await page.evaluate(()=>audit.frame.instrument.controls[0].value);
  const max=await page.evaluate(()=>audit.frame.instrument.controls[0].max);
  const first=current<max/2?127:0,second=first===127?0:127;
  await midi([176,48,first]);
  await page.waitForTimeout(140);
  assert.equal(await page.evaluate(()=>audit.frame.instrument.controls[0].value),current);
  await midi([176,48,second]);
  await page.waitForFunction(expected=>audit.frame.instrument.controls[0].value===expected,second?max:0);

  await profile.getByLabel('Control message').selectOption('twos');
  await profile.getByRole('button',{name:'Learn context control'}).click();
  await midi([176,48,1]);
  const step=second===127?127:1;
  await page.evaluate(value=>{for(let i=0;i<3;i++)audit.source.onmidimessage({data:[176,48,value],timeStamp:performance.now()});},step);
  await page.waitForFunction(expected=>audit.frame.instrument.controls[0].value===expected,second===127?max-3:3);
  await profile.getByLabel('MIDI context').selectOption('mixer');
  await profile.getByLabel('Context control').selectOption('track:volume');
  await profile.getByLabel('Control message').selectOption('absolute');
  await profile.getByRole('button',{name:'Learn context control'}).click();
  await midi([176,48,64]);
  await profile.getByLabel('Follow focused workspace or panel').check();
  await button('Enable DAW MIDI input').click();
  await page.waitForFunction(()=>audit.w.monitor.ready);
  await midi([176,64,127]);
  await midi([144,74,96]);
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&v.note===74&&v.monitorChannel===0));
  await field('DAW count-in bars').selectOption('0');
  await button('Arm selected DAW track').click();
  await button('Record DAW').click();
  await page.waitForFunction(()=>audit.w.recorder.state==='recording');
  await midi([128,74,0]);
  await page.evaluate(()=>{audit.commands.length=0;});

  const popup=await detach('Mixer');
  await popup.bringToFront();
  await page.evaluate(()=>{
    window.dispatchEvent(new Event('blur'));
    Object.defineProperty(document,'hidden',{value:true,configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(()=>audit.w.recorder.state==='recording'&&audit.frame.polyphony.slots.some(v=>v.gate&&v.note===74));
  assert(await popup.getByLabel('DAW transport status').textContent().then(s=>s.includes('Recording')));
  assert.equal(await page.evaluate(()=>audit.w.midiProfiles.profile.context),'mixer');
  await midi([176,64,0]);
  await midi([144,75,96]);
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&v.note===75));
  await midi([128,75,0]);
  await page.waitForFunction(()=>!audit.frame.polyphony.slots.some(v=>v.gate&&(v.note===74||v.note===75)));
  await page.evaluate(()=>Reflect.deleteProperty(document,'hidden'));
  // Space is routed to the same transport from the popup.
  await popup.locator('h1').click();
  await popup.keyboard.press('Space');
  await page.waitForFunction(()=>!audit.w.recorder.busy);
  const record=await page.evaluate(()=>({
    notes:audit.w.snapshot.clips.flatMap(c=>c.notes||[]).map(n=>n.pitch),
    panic:audit.commands.some(m=>m.t==='panic'),
    contexts:audit.contexts,monitor:audit.w.monitor.enabled
  }));
  assert(record.notes.includes(75)&&record.notes.includes(74)&&!record.panic&&record.contexts===1&&record.monitor,JSON.stringify(record));

  const slider=popup.getByLabel('DAW track volume',{exact:true}).first();
  await slider.fill('0.8');
  await page.waitForFunction(()=>audit.w.snapshot.tracks[0].volume===.8);
  await slider.focus();
  await popup.keyboard.press('m');
  assert.equal(await field('DAW metronome').isChecked(),false,'Focused slider suppresses global shortcut');
  await popup.locator('h1').click();
  await popup.keyboard.press('m');
  assert.equal(await field('DAW metronome').isChecked(),true);
  const before=await page.evaluate(()=>audit.w.snapshot.tracks[0].volume);
  await midi([176,48,20]);
  assert.equal(await page.evaluate(()=>audit.w.snapshot.tracks[0].volume),before,'Context pickup re-arms at current mixer value');
  const name=popup.getByLabel('DAW track name',{exact:true}).first();
  await name.evaluate(input=>{input.focus();input.value='Draft name';});
  await midi([176,48,100]);
  assert.equal(await name.inputValue(),'Draft name');
  await name.evaluate(input=>{input.value='Instrument 1';input.blur();});
  await page.waitForFunction(()=>audit.w.snapshot.tracks[0].volume>1.5);
  await popup.keyboard.press('Control+z');
  await page.waitForFunction(()=>audit.w.snapshot.tracks[0].volume===.8);
  await popup.keyboard.press('?');
  await popup.getByRole('dialog',{name:'DAW shortcuts'}).waitFor();
  await popup.getByRole('button',{name:'Close shortcuts'}).click();
  await popup.evaluate(async()=>{
    const file=await(await navigator.storage.getDirectory()).getFileHandle('popup-save.wsproj',{create:true});
    showSaveFilePicker=async()=>file;
  });
  await popup.locator('h1').click();
  await popup.keyboard.press('Control+s');
  await page.waitForFunction(()=>audit.w.files.handle?.name==='popup-save.wsproj');
  await page.waitForFunction(()=>!audit.w.controller.dirty);
  await popup.close();
  await page.waitForFunction(()=>!audit.w.layout.windows.has('mixer'));
  assert.equal(await page.evaluate(()=>audit.w.layout.mixerPane.ownerDocument===document),true);

  const clip=await detach('Clip editor');
  await clip.getByLabel('Piano Roll',{exact:true}).waitFor();
  await clip.getByRole('button',{name:'Return panel to DAW'}).click();
  await page.waitForFunction(()=>!audit.w.layout.windows.has('clip'));
  const mixer=await detach('Mixer');
  const reset=await page.evaluate(()=>JSON.stringify(audit.w.snapshot));
  await menu.locator('summary').click();
  await menu.getByRole('button',{name:'Reset layout'}).click();
  await page.waitForFunction(()=>!audit.w.layout.windows.views.size);
  assert(mixer.isClosed());
  assert.equal(await page.evaluate(()=>JSON.stringify(audit.w.snapshot)),reset);
  await page.evaluate(()=>{localStorage.setItem('test-midi-id','id-a-replugged');});
  page.on('dialog',dialog=>dialog.accept());
  await page.reload();
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.waitForFunction(()=>audit.frame?.ms>5000);
  await setup.getByRole('button',{name:'Connect MIDI keyboard',exact:true}).click();
  await page.waitForFunction(()=>!!audit.source.onmidimessage);
  assert.equal(await page.locator('#midiInput').inputValue(),'id-a-replugged');
  assert.deepEqual(errors,[]);
  const report={result:'PASS',record,mixerAndEditorDetached:true,focusPreservedMidi:true,undoFromPopup:true,contextPickup:true,profileAutoLoadWithNewPortId:true,resetPreservedProject:true,physicalValidation:false};
  fs.writeFileSync(`${root}/windows-midi.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
