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
    if(tag==='sine')await candidate.waitFor();
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
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,tag+'.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS Wizard handoff, Lab ADSR and held MIDI navigation, dry WAV capture and Working reopen',tag);
}catch(error){
  await page.screenshot({path:join(evidence,tag+'-failure.png'),fullPage:true}).catch(()=>{});
  console.error('Lab status',await page.locator('.ww-sample-lab .ww-sampler-status').allTextContents(),errors);
  throw error;
}finally{await browser.close();}
