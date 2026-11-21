// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {wavHeader} from '../../web/studio-format.js';

const dir=await mkdtemp(join(tmpdir(),'waswan-auto-'));
const evidence=process.env.WIZARD_EVIDENCE || '.local/validation/auto-instrument-wizard';
await mkdir(evidence,{recursive:true});
const synthetic=join(dir,'Áudio longo.wav');
const total=420*44100;
const fd=await open(synthetic,'wx');
try {
  await fd.write(new Uint8Array(wavHeader(total)));
  await fd.truncate(44+total*4);
  for (const [second,hz] of [[180,220],[360,330]]) {
    const bytes=Buffer.alloc(2*44100*4);
    for(let i=0;i<2*44100;i++){
      const value=Math.round(13000*Math.sin(2*Math.PI*hz*i/44100));
      bytes.writeInt16LE(value,i*4);bytes.writeInt16LE(value,i*4+2);
    }
    await fd.write(bytes,0,bytes.length,44+44100*second*4);
  }
}finally{await fd.close();}
const path=process.env.WIZARD_WAV || synthetic;
const target=process.env.WIZARD_CHARACTER || 'Sustained';
const tag=process.env.WIZARD_REPORT || 'long';
const hash=createHash('sha256');
for await (const chunk of createReadStream(path)) hash.update(chunk);
const sha256=hash.digest('hex');
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.addInitScript(()=>{
    window.audit={contexts:0,hosts:0,commands:[],frames:[],maps:[]};
    window.showDirectoryPicker=async()=>{
      if(audit.denyFolder) throw new DOMException('Folder permission denied','NotAllowedError');
      return (await navigator.storage.getDirectory()).getDirectoryHandle('Wizard tests',{create:true});
    };
    audit.source={id:'wizard-test-midi',name:'Wizard MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.source.id,audit.source]])});
    const Context=AudioContext;
    window.AudioContext=class extends Context{constructor(...args){super(...args);audit.context=this;audit.contexts++;}};
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet{
      constructor(...args){
        super(...args);if(args[1]!=='obervave-smk37')return;
        audit.node=this;audit.hosts++;
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
        const send=this.port.postMessage.bind(this.port);
        this.port.postMessage=(message,...rest)=>{
          audit.commands.push(message.t);
          if(message.t==='daw-sampler-begin'){
            audit.frames.push(...message.packed.dependencies.map(s=>s.frames));
            const r=message.packed.regions[0];
            audit.maps.push({root:r.root,loopEnd:r.loopEnd,flags:r.flags,envelopes:r.envelopes});
          }
          send(message,...rest);
        };
      }
    };
  });
  await page.goto('http://localhost:8737/simulator/');
  await startSynth(page,{connect:true});
  const nav=()=>page.locator('[data-workspace="sampler"]').first().click();
  await nav();
  const studio=page.locator('[data-view="sampler"]');
  const wizard=studio.getByRole('region',{name:'Auto Instrument Wizard'});
  const btn=name=>wizard.getByRole('button',{name,exact:true});
  const step=name=>wizard.getByRole('heading',{name,exact:true}).waitFor();
  await studio.getByRole('button',{name:'Auto Instrument Wizard',exact:true}).click();
  await step('Import');
  if(path===synthetic){
    await page.evaluate(()=>audit.denyFolder=true);
    await btn('Choose Samples folder…').click();
    await wizard.getByText('Folder permission denied',{exact:true}).waitFor();
    await page.evaluate(()=>audit.denyFolder=false);
  }
  await btn('Choose Samples folder…').click();
  const input=wizard.getByLabel('Wizard WAV');
  await input.setInputFiles(path);
  await wizard.getByText('Original verified',{exact:false}).waitFor();
  await input.setInputFiles({name:'invalid.wav',mimeType:'audio/wav',buffer:Buffer.from('invalid')});
  await wizard.getByText(/header is truncated/).waitFor();
  await wizard.getByLabel('What are you looking for?').selectOption(target);
  await btn('Next').click();
  await step('Discover');
  assert(await wizard.getByRole('checkbox').count()>=1);
  assert(await wizard.getByRole('heading',{name:'Discover'}).evaluate(n=>n===n.ownerDocument.activeElement));
  await page.screenshot({path:join(evidence,tag+'-discover.png')});
  const scope=studio.locator('details').filter({has:page.locator('summary', {hasText:/^Oscilloscope$/})});
  const scopeSignal=async()=>page.waitForFunction(()=>{
    const canvas=document.querySelector('.ww-sampler-studio .ww-scope');
    if(!canvas)return false;
    const {width,height}=canvas, data=canvas.getContext('2d').getImageData(0,0,width,height).data;
    let top=height,bottom=-1;
    for(let i=0;i<data.length;i+=4) if(data[i]===39 && data[i+1]===227 && data[i+2]===221){
      const row=Math.floor(i/4/width);top=Math.min(top,row);bottom=Math.max(bottom,row);
    }
    return bottom-top>5;
  });
  if(path===synthetic){
    await scope.locator('summary').click();
    await scope.getByLabel('Scope input').selectOption('preview');
    await scope.scrollIntoViewIfNeeded();
    await btn('Listen').first().evaluate(b=>b.click());
    await scopeSignal();
    await scope.getByText('Play a WAV selection to see its waveform').waitFor();
    await scope.getByLabel('Scope input').selectOption('output');
    await scope.locator('summary').click();
  }else{
    await btn('Listen').first().click();
    await btn('Stop preview').click();
  }
  if(path===synthetic) {
    await btn('Select on waveform').click();
    const start=wizard.getByLabel('Start frame',{exact:true}),end=wizard.getByLabel('End frame',{exact:true});
    await start.fill(String(180.25*44100));await start.press('Tab');
    await end.fill(String(181*44100));await end.press('Tab');
    await btn('Use waveform selection').click();
    assert.equal(await wizard.getByRole('checkbox',{checked:true}).count(),2);
  }
  await btn('Next').click();await step('Build');
  await btn('Back').click();await step('Discover');
  await btn('Next').click();await step('Build');
  const name='Wizard '+tag;
  await wizard.getByLabel('Name',{exact:true}).first().fill(name);
  await btn('Next').click();await step('Play & Finish');
  assert.deepEqual(await page.evaluate(()=>audit.frames),[]);
  const fx=wizard.getByLabel('Keyboard FX',{exact:true});
  assert.equal(await fx.inputValue(),'dry');
  await btn('Play on Keyboard').first().click();
  await btn('Release Keyboard').waitFor();
  await page.evaluate(()=>{
    audit.meter=audit.context.createAnalyser();audit.node.connect(audit.meter);
    audit.note=(n,on)=>audit.source.onmidimessage({data:[on?0x90:0x80,n,on?100:0],timeStamp:performance.now()});
    audit.peak=()=>{const pcm=new Float32Array(2048);audit.meter.getFloatTimeDomainData(pcm);
      return pcm.reduce((max,v)=>Math.max(max,Math.abs(v)),0);};
    audit.root=audit.maps.at(-1).root;
    audit.note(audit.root-12,true);audit.note(audit.root+12,true);
  });
  await page.waitForFunction(()=>audit.peak()>0.001);
  if(path===synthetic){
    const bindings=await page.evaluate(()=>audit.commands.filter(t=>t==='daw-sampler-live').length);
    await fx.selectOption('synth');await fx.selectOption('dry');
    await page.waitForFunction(()=>audit.commands.filter(t=>t==='daw-sampler-keyboard-fx').length===2);
    assert.equal(await page.evaluate(()=>audit.commands.filter(t=>t==='daw-sampler-live').length),bindings);
    await scope.locator('summary').click();
    await scope.scrollIntoViewIfNeeded();
    await scopeSignal();
    await scope.screenshot({path:join(evidence,'keyboard-oscilloscope.png')});
    await scope.locator('summary').click();
  }
  const loop=await page.evaluate(()=>audit.maps.at(-1).loopEnd);
  let heldPeak=null;
  if(loop){
    await page.waitForTimeout(1300);
    heldPeak=await page.evaluate(()=>audit.peak());
    assert(heldPeak>0.001);
  }
  await page.evaluate(()=>{audit.note(audit.root-12,false);audit.note(audit.root+12,false);});
  await page.waitForFunction(()=>audit.peak()<0.0001);
  await btn('Release Keyboard').click();
  if(path===synthetic) {
    await page.evaluate(async()=>{
      const {search}=await import('./sampler-library.js');
      const entries=await search(await showDirectoryPicker(),{kind:'sample'});
      if(entries.items.some(e=>e.path.startsWith('Samples/Processed/'))) throw Error('Preview wrote a physical derivative');
      const handles=FileSystemDirectoryHandle.prototype, original=handles.getFileHandle;
      let writes=0;
      handles.getFileHandle=async function(name,options){
        if(this.name==='Drafts' && options?.create && ++writes===2){
          handles.getFileHandle=original;
          throw new DOMException('Simulated disk full','QuotaExceededError');
        }
        return original.call(this,name,options);
      };
    });
    await btn('Finish & Play').click();
    await wizard.getByText('Saved Working / playable',{exact:true}).waitFor();
    await wizard.getByText(/Simulated disk full|quota|storage space/i).first().waitFor();
  }
  await btn('Finish & Play').click();
  await wizard.getByText('Saved Working / playable',{exact:true}).nth(path===synthetic?1:0).waitFor();
  await page.screenshot({path:join(evidence,tag+'-finish.png')});
  const docs=await page.evaluate(async()=>{
    const root=await showDirectoryPicker();
    const {listWorking,openWorking}=await import('./sampler-working.js');
    const {search,inspectSample}=await import('./sampler-library.js');
    const items=await listWorking(root);
    const drafts=[];
    for(const item of items)drafts.push(await openWorking(root,item.id));
    const source=await inspectSample(root,drafts[0].source.path,{verify:true});
    return {source,drafts,officials:(await search(root,{kind:'instrument'})).items.length};
  });
  assert.equal(docs.source.sha256,sha256);
  assert.equal(docs.officials,0);
  assert.equal(docs.drafts.length,path===synthetic?2:1);
  const first=docs.drafts.find(d=>d.name===name);
  assert.equal(first.rendered.source.sha256,sha256);
  assert.equal(first.rendered.sampleRate,44100);
  const commands=await page.evaluate(()=>audit.commands.filter(t=>t==='daw-sampler-live'));
  assert.equal(commands.length,2);
  await btn('Edit Advanced').first().click();
  await studio.getByText('Working Copy open · '+name,{exact:true}).waitFor();
  assert.equal(await studio.getByLabel('Working name',{exact:true}).inputValue(),name);
  const observed=await page.evaluate(()=>({hosts:audit.hosts,contexts:audit.contexts,frames:audit.frames,maps:audit.maps}));
  assert.equal(observed.hosts,1);assert.equal(observed.contexts,1);
  assert(observed.frames.every(n=>n<=44100));
  // Opening and canceling another wizard preserves the advanced session.
  await studio.getByRole('button',{name:'Auto Instrument Wizard',exact:true}).click();
  await btn('Cancel').click();
  assert.equal(await studio.getByLabel('Working name',{exact:true}).inputValue(),name);
  if(path===synthetic){
    const advancedFx=studio.locator('.ww-sampler-layout').getByLabel('Keyboard FX',{exact:true});
    await advancedFx.selectOption('synth');
    await studio.getByRole('button',{name:'Play on Synth keyboard',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.ww-sampler-route')?.textContent.includes('Working') ||
      [...document.querySelectorAll('.ww-sampler-route')].some(n=>n.textContent.includes('Wizard long · Working')));
    const prior=await studio.locator('.ww-sampler-route').first().innerText();
    await studio.getByRole('button',{name:'Auto Instrument Wizard',exact:true}).click();
    await wizard.getByLabel('Wizard WAV').setInputFiles(path);
    await wizard.getByText('Original verified',{exact:false}).waitFor();
    await btn('Next').click();await step('Discover');
    await btn('Next').click();await step('Build');
    await btn('Next').click();await step('Play & Finish');
    assert.equal(await fx.inputValue(),'dry');
    await btn('Play on Keyboard').first().click();
    await btn('Release Keyboard').click();
    await btn('Cancel').click();
    assert.equal(await studio.locator('.ww-sampler-route').first().innerText(),prior);
    assert.equal(await advancedFx.inputValue(),'synth');
    await studio.getByRole('button',{name:'Release Synth keyboard',exact:true}).click();
    await studio.getByRole('button',{name:'Auto Instrument Wizard',exact:true}).click();
    await wizard.getByLabel('Wizard WAV').setInputFiles(path);
    await wizard.getByText('Original verified',{exact:false}).waitFor();
    await btn('Next').click();await btn('Cancel').click();
    assert.equal(await studio.getByLabel('Working name',{exact:true}).inputValue(),name);
  }
  await page.reload();await nav();
  await studio.getByRole('button',{name,exact:true}).first().click();
  await studio.getByText('Working Copy reopened · '+name,{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  const report={input:basename(path),originalSha256:sha256,originalFrames:docs.source.frames,sourceRate:docs.source.sampleRate,
    saved:docs.drafts.length,root:first.rootNote,selection:first.selection,loop:first.instrument.regions[0].loop??null,
    gainDb:first.instrument.regions[0].gainDb,envelope:first.instrument.regions[0].envelope,
    heldPeak,observed,browser:browser.version(),midi:'simulated',officials:docs.officials};
  await writeFile(join(evidence,tag+'.json'),JSON.stringify(report,null,2));
  console.log('PASS wizard',report);
}catch(error){
  await page.screenshot({path:join(evidence,tag+'-failure.png')});
  console.error(await page.locator('.ww-auto-wizard').allTextContents(),errors);
  throw error;
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
