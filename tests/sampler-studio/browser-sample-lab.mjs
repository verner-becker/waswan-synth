// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {decodeWav} from '../../web/sampler-wav.js';
import {encodeSample} from '../../web/sampler-offline.js';

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const evidence=process.env.LAB_EVIDENCE||'.local/validation/sample-lab';
const tag=process.env.LAB_REPORT||'sine';
const recording=process.env.LAB_WAV;
const compare=process.env.LAB_COMPARE==='1';
const processor=process.env.LAB_PROCESSOR||'wsola';
const experimental=processor==='signalsmith-stretch';
const shift=experimental?3:7;
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir(evidence,{recursive:true});
try{
  await page.addInitScript(()=>{
    window.audit=window.labAudit={contexts:0,hosts:0,messages:[]};
    showDirectoryPicker=async()=> (await navigator.storage.getDirectory()).getDirectoryHandle('Lab test',{create:true});
    const source={id:'lab-midi',name:'Lab MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[source.id,source]])});
    window.labAudit.note=(note,velocity)=>source.onmidimessage({
      data:[velocity?0x90:0x80,note,velocity],timeStamp:performance.now(),
    });
    const Context=AudioContext;
    window.AudioContext=class extends Context{constructor(...args){super(...args);labAudit.context=this;labAudit.contexts++;}};
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet{
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        labAudit.hosts++;
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')labAudit.frame=data;});
        labAudit.meter=labAudit.context.createAnalyser();this.connect(labAudit.meter);
        labAudit.peak=()=>{
          const pcm=new Float32Array(2048);labAudit.meter.getFloatTimeDomainData(pcm);
          return pcm.reduce((max,v)=>Math.max(max,Math.abs(v)),0);
        };
        const send=this.port.postMessage.bind(this.port);
        this.port.postMessage=(m,...rest)=>{
          if(m.t==='daw-sampler-begin')labAudit.root=m.packed.regions[0].root;
          labAudit.messages.push(m.t);send(m,...rest);
        };
      }
    };
  });
  await page.goto('http://localhost:8737/simulator/');
  await startSynth(page,{connect:true});
  const nav=name=>page.locator('[data-workspace="'+name+'"]').first().click();
  await nav('sampler');
  const studio=page.locator('[data-view="sampler"]');
  const wizard=studio.getByRole('region',{name:'Auto Instrument Wizard'});
  const lab=studio.getByRole('region',{name:'Sample Lab',exact:true});
  const wb=name=>wizard.getByRole('button',{name,exact:true});
  const lb=name=>lab.getByRole('button',{name,exact:true});
  const wav=recording||{name:'Lab harmonic fixture.wav',mimeType:'audio/wav',
    buffer:Buffer.from(await encodeSample({sampleRate:44100,channels:1,pcm:Float32Array.from({length:88200},(_,i)=>
      .32*(Math.sin(2*Math.PI*220*i/44100)+.14*Math.sin(2*Math.PI*440*i/44100)))}).arrayBuffer())};
  await studio.getByRole('button',{name:'Auto Instrument Wizard',exact:true}).click();
  await wb('Choose Samples folder…').click();
  await wizard.getByLabel('Wizard WAV').setInputFiles(wav);
  await wizard.getByText(/Original verified/).waitFor();
  await wizard.getByLabel('What are you looking for?').selectOption(process.env.LAB_CHARACTER||'Sustained');
  await wb('Next').click();
  await wizard.getByRole('heading',{name:'Discover',exact:true}).waitFor();
  await wb('Next').click();
  await wizard.getByRole('heading',{name:'Build',exact:true}).waitFor();
  await wizard.getByLabel('Name',{exact:true}).fill('Sample Lab '+tag);
  if((process.env.LAB_CHARACTER||'')==='Plucked')await wizard.getByLabel('Root note (MIDI)',{exact:true}).selectOption('69');
  await wb('Next').click();
  await wb('Refine in Sample Lab').click();
  await lab.getByText(/Source level/).waitFor();
  await lab.getByLabel('Envelope preset',{exact:true}).selectOption(tag==='guitar'?'Guitar Pluck':'Vocal Sustain');
  await lab.getByLabel('Release (ms)',{exact:true}).fill('190');
  await lab.getByLabel('Release (ms)',{exact:true}).press('Tab');
  if(tag!=='guitar'){
    await lb('Optimize Loop').click();
    const candidate=lab.getByRole('button',{name:/^Candidate 1/});
    await lab.getByText(/Select a forward loop|No suitable loop found/).waitFor();
    if(tag==='sine'||tag.startsWith('voice'))await candidate.waitFor();
    if(await candidate.count())await candidate.click();
  }
  await lb('Play on Keyboard').click();
  await lab.getByText('Dry keyboard preview active.').waitFor();
  await page.evaluate(()=>labAudit.note(labAudit.root,100));
  await page.waitForFunction(()=>labAudit.peak()>.005);
  const before=await page.evaluate(()=>labAudit.messages.filter(t=>t==='daw-sampler-live').length);
  await nav('perf');await nav('sampler');
  assert.equal(await page.evaluate(()=>labAudit.messages.filter(t=>t==='daw-sampler-live').length),before);
  if(tag!=='guitar')await page.waitForFunction(()=>labAudit.peak()>.005);
  await page.evaluate(()=>labAudit.note(labAudit.root,0));
  await page.waitForFunction(()=>labAudit.peak()<.0002);
  await lab.getByLabel('Performance test',{exact:true}).selectOption('chord');
  await lb('Run dry test').click();
  await lab.getByText('Dry capture ready.',{exact:true}).waitFor({timeout:12000});
  assert.match(await lab.locator('.ww-lab-report').innerText(),/0 samples above full scale/);
  const download=page.waitForEvent('download');
  await lb('Download WAV').click();
  const file=join(evidence,tag+'-chord.wav');
  await (await download).saveAs(file);
  const read=await import('node:fs/promises');
  const captured=await decodeWav(await read.readFile(file));
  assert(captured.frames>44100&&captured.pcm.some(v=>Math.abs(v)>300));
  const report={text:await lab.locator('.ww-lab-report').innerText(),frames:captured.frames,
    ...await page.evaluate(()=>({hosts:labAudit.hosts,contexts:labAudit.contexts}))};
  assert.equal(report.hosts,1);assert.equal(report.contexts,1);
  await lb('Apply to Working Copy').click();
  await lab.getByText(/Variant applied to the Working Copy/).waitFor();
  await lb('Save Working').click();
  await lab.getByText('Working Copy saved.',{exact:true}).waitFor();
  await page.screenshot({path:join(evidence,tag+'-lab.png'),fullPage:true});
  const copy=await page.evaluate(async()=>{
    const root=await showDirectoryPicker(),working=await import('./sampler-working.js');
    const [entry]=await working.listWorking(root);
    return working.openWorking(root,entry.id);
  });
  assert.equal(copy.instrument.regions[0].envelope.releaseMs,190);
  assert.equal(copy.rendered.source.sha256,copy.source.sha256);
  report.source=copy.source.sha256;report.loop=copy.instrument.regions[0].loop;report.envelope=copy.instrument.regions[0].envelope;
  if(compare){
    await lab.locator('summary').filter({hasText:/^Pitch & Timbre$/}).click();
    await lab.getByLabel('Offline pitch processor',{exact:true}).selectOption(processor);
    await lab.getByLabel('Anchor shift (semitones)',{exact:true}).fill(String(shift));
    await lab.getByLabel('Processor fine tuning (cents)',{exact:true}).fill(experimental?'0':'20');
    await lb('Render variant B').click();
    await lab.getByText(/^B ready/).waitFor();
    await lab.getByLabel('Performance test',{exact:true}).selectOption('note-12');
    await lb('Compare A/B with selected sequence').click();
    await lab.getByText('Dry A/B captures ready.',{exact:true}).waitFor({timeout:15000});
    report.comparison={};
    let comparisonFrames;
    for(const slot of ['A','B']){
      await lab.getByLabel('Pitch variant',{exact:true}).selectOption(slot);
      const downloading=page.waitForEvent('download');
      await lb('Download WAV').click();
      const path=join(evidence,tag+'-pitch-'+slot+'.wav');
      await (await downloading).saveAs(path);
      const pitched=await decodeWav(await read.readFile(path));
      comparisonFrames??=pitched.frames;
      assert.equal(pitched.frames,comparisonFrames);
      report.comparison[slot]=await lab.locator('.ww-lab-report').innerText();
    }
    if(!recording){
      const measured=['A','B'].map(slot=>Number(report.comparison[slot].match(/([\d.]+) Hz ·/u)?.[1]));
      assert(measured.every(hz=>Math.abs(hz-440)<2));
      assert(Math.abs(measured[0]-measured[1])<1);
    }
    await lb('Save variant as new Working Copy').click();
    await lab.getByText(/^Variant saved as a new Working Copy/).waitFor();
    const persisted=await page.evaluate(async()=>{
      const root=await showDirectoryPicker(),working=await import('./sampler-working.js');
      const items=await working.listWorking(root);
      return Promise.all(items.map(d=>working.openWorking(root,d.id)));
    });
    assert.equal(persisted.length,2);
    const deriv=persisted.find(d=>d.id!==copy.id);
    assert.deepEqual(persisted.find(d=>d.id===copy.id),copy);
    assert(deriv.instrument.samples[0].recipe.operations.some(op=>op.algorithm===processor&&op.algorithmVersion===1));
    assert.equal(deriv.instrument.regions[0].root,copy.instrument.regions[0].root+shift);
    assert.equal(deriv.source.sha256,copy.source.sha256);
    await page.screenshot({path:join(evidence,tag+'-pitch.png'),fullPage:true});
    if(process.env.LAB_ANCHORS==='1'){
      await lb('Save keyboard regions as Working Copy').click();
      await lab.getByText(/^Working Copy saved with anchors/).waitFor();
      const anchors=await page.evaluate(async()=>{
        const root=await showDirectoryPicker(),working=await import('./sampler-working.js');
        const entry=(await working.listWorking(root)).find(d=>d.name.endsWith(' · Keyboard regions'));
        const draft=await working.openWorking(root,entry.id);
        return draft.instrument.regions.map(({root,key})=>({root,key}));
      });
      const original=copy.instrument.regions[0].root;
      assert.deepEqual(anchors.map(region=>region.root),[original-shift,original,original+shift]);
      assert.equal(anchors[0].key[1]+1,anchors[1].key[0]);
      assert.equal(anchors[1].key[1]+1,anchors[2].key[0]);
      report.anchors=anchors;
    }
  }
  if(process.env.LAB_STRESS==='1'){
    await lab.getByLabel('Pitch variant',{exact:true}).selectOption('A');
    await lab.getByLabel('Region gain (dB)',{exact:true}).fill('15');
    await lab.getByLabel('Region gain (dB)',{exact:true}).press('Tab');
    await lab.getByLabel('Performance test',{exact:true}).selectOption('chord');
    await lb('Run dry test').click();
    await lab.getByText('Dry capture ready.',{exact:true}).waitFor({timeout:12000});
    report.overload=await lab.locator('.ww-lab-report').innerText();
    assert.match(report.overload,/[1-9][0-9]* samples above full scale · lower the gain/);
  }
  if(process.env.LAB_RAW==='1'){
    await lb('Release Keyboard').click();
    await lb('Close Sample Lab').click();
    const wav48=encodeSample({sampleRate:48000,channels:2,
      pcm:Float32Array.from({length:48000*2},(_,i)=>.25*Math.sin(2*Math.PI*220*(i>>1)/48000))});
    await studio.getByLabel('Import WAV',{exact:true}).setInputFiles({
      name:'Lab direct 48k.wav',mimeType:'audio/wav',buffer:Buffer.from(await wav48.arrayBuffer()),
    });
    await studio.getByText(/Source · Samples\/Originals\/Lab direct 48k.wav/).waitFor();
    await studio.getByRole('button',{name:'Sample Lab',exact:true}).click();
    await lab.getByText(/Source level/).waitFor();
    const curve=lab.getByRole('img',{name:'Amplitude ADSR curve',exact:true});
    await curve.scrollIntoViewIfNeeded();
    const box=await curve.boundingBox();
    await page.mouse.move(box.x+box.width*28/720,box.y+box.height*34/180);
    await page.mouse.down();
    await page.mouse.move(box.x+box.width*90/720,box.y+box.height*34/180);
    await page.mouse.up();
    assert(Number(await lab.getByLabel('Attack (ms)',{exact:true}).inputValue())>5);
    const wave=lab.getByRole('img',{name:/^Waveform with attack/});
    await wave.scrollIntoViewIfNeeded();
    const bounds=await wave.boundingBox();
    const previous=await lab.getByLabel('Loop start (frames)',{exact:true}).inputValue();
    await page.mouse.move(bounds.x+bounds.width*.25,bounds.y+bounds.height*.5);
    await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.30,bounds.y+bounds.height*.5);
    await page.mouse.up();
    assert.notEqual(await lab.getByLabel('Loop start (frames)',{exact:true}).inputValue(),previous);
    await lb('Promote to Official').click();
    await lab.getByText(/^Official r1 published/).waitFor();
    report.directWav=true;
  }
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,tag+'.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS Wizard handoff, Lab ADSR and held MIDI navigation, dry WAV capture and Working reopen',tag);
}catch(error){
  await page.screenshot({path:join(evidence,tag+'-failure.png'),fullPage:true}).catch(()=>{});
  console.error('Lab status',await page.locator('.ww-sample-lab .ww-sampler-status').allTextContents(),errors);
  throw error;
}finally{await browser.close();}
