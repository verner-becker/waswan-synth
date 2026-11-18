// SPDX-License-Identifier: GPL-3.0-only
import {clickDawFile} from './daw-browser-controls.mjs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/daw-mvp-acceptance';
const base=process.env.WASWAN_BASE_URL||'http://localhost:8737/simulator/';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({viewport:{width:1536,height:1100}});
const errors=[];
context.on('page',page=>page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);}));
await context.addInitScript(()=>{
  window.audit={contexts:0,hosts:0,mediaCalls:0};
  const AC=AudioContext;
  window.AudioContext=class extends AC{constructor(...args){super(...args);audit.context=this;audit.contexts++;}};
  const AN=AudioWorkletNode;
  window.AudioWorkletNode=class extends AN{
    constructor(...args){
      super(...args);
      if(args[1]!=='obervave-smk37')return;
      audit.node=this;audit.hosts++;
      this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});
    }
  };
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{audit.mediaCalls++;throw Error('Microphone must stay unopened in this test');};
});
const daw=page=>page.locator('.ww-daw');
const button=(page,name)=>daw(page).getByRole('button',{name,exact:true});
const field=(page,name)=>daw(page).getByLabel(name,{exact:true});
async function linked(host){
  const opening=host.waitForEvent('popup');
  await host.getByRole('button',{name:'Open DAW in new tab',exact:true}).click();
  const tab=await opening;
  await daw(tab).waitFor();
  return tab;
}
try{
  const host=await context.newPage();
  await host.goto(base+'?workspace=daw');
  await host.getByRole('button',{name:'Start audio',exact:true}).click();
  await host.waitForFunction(()=>audit.frame?.ms>5000);
  await host.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
  await host.evaluate(async()=>{
    const {DawMix}=await import('./ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.w=this.w;return refresh.apply(this,args);};
  });
  await button(host,'Add audio track').click();
  await host.evaluate(()=>{
    audit.workspace=audit.w.node;audit.project=audit.w.controller;
    audit.node.port.postMessage({t:'midi',st:144,d1:72,d2:92});
  });
  await host.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&v.note===72));
  const tab=await linked(host);
  assert.equal(await tab.evaluate(()=>audit.contexts),0);
  assert(await host.evaluate(()=>audit.workspace===audit.w.node&&audit.project===audit.w.controller&&audit.w.node.ownerDocument!==document));
  await tab.getByRole('button',{name:'Focus Synth',exact:true}).click();
  assert(await daw(tab).isVisible(),'Changing the host view keeps the tab visible');
  assert(await host.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate&&v.note===72)));
  await host.evaluate(()=>audit.node.port.postMessage({t:'midi',st:128,d1:72,d2:0}));
  await host.waitForFunction(()=>!audit.frame.polyphony.slots.some(v=>v.gate&&v.note===72));
  await button(tab,'File').click();
  await field(tab,'DAW project name').fill('Shared DAW');
  await field(tab,'DAW project name').press('Tab');
  await tab.keyboard.press('Escape');
  assert.equal(await host.evaluate(()=>audit.w.snapshot.name),'Shared DAW');

  const initialTrack=await host.evaluate(()=>audit.w.selected);
  await tab.evaluate(async()=>{
    const {wavHeader}=await import('./studio-format.js');
    const pcm=new Int16Array(44100*4).fill(4096),file=new File([wavHeader(88200),pcm],'tab-guide.wav',{type:'audio/wav'});
    const transfer=new DataTransfer();transfer.items.add(file);
    const lane=document.querySelector('.ww-daw-arrangement-row [data-track-lane]')||document.querySelector('.ww-daw-arrangement-row .ww-daw-lane');
    const view=document.querySelector('.ww-daw-arrangement-scroll');
    const box=view.getBoundingClientRect();
    (lane||view).dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,clientX:box.left+300,clientY:box.top+75,bubbles:true,cancelable:true}));
  });
  await host.waitForFunction(()=>!audit.w.busy&&audit.w.snapshot.assets.length===1);
  await host.evaluate(()=>{
    const w=audit.w,c=w.snapshot.clips[0];
    w.controller.command('batch',{commands:[
      {type:'clip.update',payload:{id:c.id,changes:{position:{unit:'ticks',value:0}}}},
      {type:'project.update',payload:{length:3840,transport:{loop:true,start:0,end:3840}}}
    ]});
  });
  await tab.evaluate(async()=>{
    const fs=await navigator.storage.getDirectory(),project=await fs.getFileHandle('linked.wsproj',{create:true});
    showSaveFilePicker=async()=>project;showOpenFilePicker=async()=>[project];
  });
  await clickDawFile(tab.locator('.ww-daw'),'Save DAW project');
  await host.waitForFunction(()=>!audit.w.busy&&!audit.w.controller.dirty);
  await clickDawFile(tab.locator('.ww-daw'),'Open DAW project');
  await host.waitForFunction(()=>!audit.w.busy&&audit.w.controller!==audit.project);
  assert.equal(await host.evaluate(()=>audit.w.snapshot.name),'Shared DAW');

  const viewMenu=daw(tab).locator('.ww-daw-view-menu');
  await viewMenu.locator('summary').click();
  const popup=tab.waitForEvent('popup');
  await viewMenu.getByRole('button',{name:'Detach Mixer',exact:true}).click();
  const mixer=await popup;
  const trackPeak=mixer.getByLabel('Track peak · Audio 1',{exact:true});
  await trackPeak.waitFor();
  await field(tab,'DAW metronome').check();
  await field(tab,'DAW metronome volume').fill('80');
  await button(tab,'Play DAW').click();
  await host.waitForFunction(()=>audit.w.player.playing);
  await mixer.waitForFunction(()=>document.querySelector('.ww-daw-mixer-meter').value>.1);
  await mixer.waitForFunction(()=>{
    const text=document.querySelector('[aria-label="Mixer Master stereo peaks"]').textContent;
    return /L -?\d/.test(text);
  });
  const clickProbe=async()=>host.evaluate(async()=>{
    const p=audit.w.player,probe=p.context.createAnalyser();
    probe.fftSize=512;p.click.connect(probe);
    const data=new Float32Array(512);let peak=0;
    try{
      const end=performance.now()+650;
      while(performance.now()<end){
        probe.getFloatTimeDomainData(data);
        for(const v of data)peak=Math.max(peak,Math.abs(v));
        await new Promise(resolve=>setTimeout(resolve,4));
      }
    }finally{p.click.disconnect(probe);}
    return peak;
  });
  const loud=await clickProbe();
  await field(tab,'DAW metronome volume').fill('20');
  const quiet=await clickProbe();
  await field(tab,'DAW metronome volume').fill('0');
  const off=await clickProbe();
  assert(loud>.1&&quiet>.023&&Math.abs(loud/quiet-4)<.25&&off===0,JSON.stringify({loud,quiet,off}));
  assert.equal(await mixer.locator('.ww-daw-mixer-meter').evaluate(m=>m.value),.125);
  await mixer.getByRole('button',{name:'Return panel to DAW'}).click();

  await tab.close();
  await host.waitForFunction(()=>audit.w.node.ownerDocument===document&&audit.w.player.playing);
  assert.equal(await host.evaluate(()=>audit.contexts),1);
  await host.locator('[data-workspace="daw"]').click();
  await button(host,'Stop DAW').click();
  await host.waitForFunction(()=>!audit.w.player.playing);
  assert.equal(await host.evaluate(()=>audit.w.controller.snapshot().tracks[0].id),initialTrack);

  const control=await context.newPage();
  await control.goto(base+'?workspace=daw');
  await control.getByRole('button',{name:'Start audio',exact:true}).click();
  await control.getByText('Audio is running in another WASWAN tab.',{exact:false}).first().waitFor();
  assert.equal(await control.evaluate(()=>audit.contexts),0);
  await control.close();

  // Two internal takes: an audible accompaniment plus click must write silence
  // until the live Synth itself sounds. Speaker mute only changes monitoring.
  await button(host,'Add audio track').click();
  await button(host,'Show Track inspector').click();
  await button(host,'Arm Audio 2').click();
  await field(host,'DAW count-in bars').selectOption('0');
  await field(host,'DAW audio input device').selectOption('waswan:internal-synth');
  await field(host,'DAW metronome volume').fill('80');
  await host.evaluate(async()=>{
    const w=audit.w,{uuid,makeTrack}=await import('./daw-project.js'),track=makeTrack('midi','Drum accompaniment');
    const {patch}=await w.player.drumKit(0);
    track.instrument={type:'drumx',patch};
    w.controller.command('batch',{commands:[
      {type:'track.create',payload:track},
      {type:'clip.add',payload:{id:uuid(),type:'midi',name:'Drums',trackId:track.id,position:{unit:'ticks',value:0},
        length:3840,loopLength:3840,loop:false,notes:[{id:uuid(),pitch:36,start:0,duration:480,velocity:99}]}}
    ]});
    const {context,node,gain}=w.bridge.getAudio();
    gain.gain.value=0;
    audit.legacyPart=audit.frame.track;
    audit.legacyPatch=(await w.player.requests().request('daw-state-request')).patches[audit.legacyPart];
    const splitter=context.createChannelSplitter(2);node.connect(splitter,0);
    audit.raw=[0,1].map(channel=>{
      const probe=context.createAnalyser();probe.fftSize=1024;
      splitter.connect(probe,channel);
      return probe;
    });
    audit.rawSamples=new Float32Array(1024);
  });
  await host.waitForFunction(()=>{
    return audit.raw.every(probe=>{
      probe.getFloatTimeDomainData(audit.rawSamples);
      return audit.rawSamples.every(v=>Math.abs(v)<=8/32768);
    });
  },null,{timeout:16000});
  async function take(note){
    await button(host,'Record DAW').click();
    await host.waitForFunction(()=>audit.w.recorder.state==='recording');
    if(note){
      await host.evaluate(note=>audit.node.port.postMessage({t:'midi',st:144,d1:note,d2:99}),note);
      await host.waitForFunction(note=>audit.frame.polyphony.slots.some(v=>v.gate&&v.note===note),note);
      await host.waitForTimeout(360);
      await host.evaluate(note=>audit.node.port.postMessage({t:'midi',st:128,d1:note,d2:0}),note);
    }
    await host.waitForFunction(()=>!audit.w.recorder.busy);
    return host.evaluate(async()=>{
      const w=audit.w,c=w.snapshot.clips.find(c=>c.trackId===w.selected),pcm=new Int16Array(await w.controller.assets.get(c.assetId).arrayBuffer(),44);
      let peak=0;for(const sample of pcm)peak=Math.max(peak,Math.abs(sample));
      const firstPeak=pcm.slice(0,512).reduce((max,v)=>Math.max(max,Math.abs(v)),0);
      return {frames:c.frames,peak,firstPeak,tapRemoved:!w.recorder.synthTap,id:c.assetId};
    });
  }
  const silence=await take(),performance=await take(62);
  assert.equal(silence.frames,88200);
  // A previously played Synth can retain the last few PCM counts of DSP
  // decay. The .125 accompaniment and .128 click are thousands of counts.
  assert(silence.peak<=8,'Synth-only take contains more than its background floor: '+JSON.stringify(silence));
  assert(performance.frames===88200&&performance.peak>500&&performance.firstPeak<=8&&performance.tapRemoved);
  await button(host,'Undo DAW edit').click();
  assert(await host.evaluate(id=>audit.w.snapshot.clips.some(c=>c.assetId===id),silence.id));
  const media=await host.evaluate(async()=>{
    const state=await audit.w.player.requests().request('daw-state-request');
    const reserved=!((state.slots>>audit.legacyPart)&1)&&JSON.stringify(state.patches[audit.legacyPart])===JSON.stringify(audit.legacyPatch);
    return {contexts:audit.contexts,hosts:audit.hosts,mediaCalls:audit.mediaCalls,reserved};
  });
  assert.deepEqual(media,{contexts:1,hosts:1,mediaCalls:0,reserved:true});
  const finalTab=await linked(host);
  await host.close();
  if(!finalTab.isClosed())await finalTab.waitForEvent('close',{timeout:8000});
  assert.deepEqual(errors,[]);
  const report={result:'PASS',loud,quiet,off,silence,performance,media,linkedFileAndMixer:true,returnDuringPlay:true,hostCloseEndsLinkedTab:true,physicalValidation:false};
  fs.writeFileSync(`${root}/browser-mvp-acceptance.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await browser.close();}
