// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';

const evidence='.local/validation/sampler-ux-5';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.audit={routes:[],hosts:0};
    audit.input={id:'comparison',name:'Comparison MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.input.id,audit.input]])});
    window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('Versions',{create:true});
    const Base=AudioWorkletNode;
    window.AudioWorkletNode=class extends Base {constructor(...args){
      super(...args);
      if(args[1]!=='obervave-smk37')return;
      audit.hosts++;
      const send=this.port.postMessage.bind(this.port);
      this.port.postMessage=(m,...args)=>{if(m.t==='daw-sampler-live')audit.routes.push(m.ref);return send(m,...args);};
      this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});
      audit.context=args[0];audit.host=this;
    }};
  });
  await page.goto(process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/');
  await startSynth(page,{connect:true});
  const {editId,checkpoint}=await page.evaluate(async()=>{
    const {initializeLibrary,importOriginal,publish}=await import('./sampler-library.js');
    const {encodeSample}=await import('./sampler-offline.js');
    const {createWorking,createCheckpoint,updateWorking,saveWorking}=await import('./sampler-working.js');
    const {createInstrument}=await import('./sampler-instrument.js');
    const {DawMix}=await import('./ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.workspace=this.w;return refresh.apply(this,args);};
    const root=await showDirectoryPicker(),book=await initializeLibrary(root);
    const samples=[];
    for(const hz of [220,330,550]){
      const wav=encodeSample({sampleRate:44100,channels:1,pcm:Float32Array.from({length:44100},(_,i)=>.3*Math.sin(2*Math.PI*hz*i/44100))});
      samples.push(await importOriginal(root,wav,'Samples/Originals/sine-'+hz+'.wav',{id:'s'+hz}));
    }
    const instrument=createInstrument({name:'Bell layers',samples,regions:[
      {id:'quiet',group:'main',root:60,sample:'s220',velocity:[1,63]},
      {id:'strong',group:'main',root:60,sample:'s330',velocity:[64,127]}]});
    const ref=await publish(root,instrument,{path:'Instruments/Bell layers',expectedRevision:0});
    let draft=createWorking({libraryId:book.id,source:samples[0],instrument,name:'Bell editing',baseRef:ref});
    draft=await createCheckpoint(root,draft,'Dark high velocities');
    const newer=structuredClone(instrument);newer.regions[1].sample='s550';
    const saved=await saveWorking(root,updateWorking(draft,{instrument:newer}));
    return {editId:saved.id,checkpoint:saved.history.checkpoints[0].id};
  });
  const nav=id=>page.locator('[data-workspace='+id+']').first().click();
  await nav('daw');
  await page.locator('[data-view=daw]').getByRole('button',{name:'Add MIDI track',exact:true}).click();
  await page.waitForFunction(()=>audit.workspace?.snapshot.tracks.length===1);
  const originalTrack=await page.evaluate(()=>audit.workspace.selectedTrack().instrument);
  await nav('sampler');
  const s=page.locator('[data-view=sampler]');
  const idle=()=>page.waitForFunction(()=>!document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  const press=async label=>{await s.getByRole('button',{name:label,exact:true}).click();await idle();};
  await press('Choose Samples folder…');await press('Bell editing');
  const field=label=>s.getByLabel(label,{exact:true});
  const pitches=[];
  async function heard(velocity,hz){
    await page.evaluate(v=>{
      if(!audit.meter){audit.meter=audit.context.createAnalyser();audit.meter.fftSize=8192;audit.host.connect(audit.meter);}
      audit.input.onmidimessage({data:[0x90,60,v],timeStamp:performance.now()});
    },velocity);
    await page.waitForFunction(hz=>{
      const pcm=new Float32Array(8192);audit.meter.getFloatTimeDomainData(pcm);
      let count=0;for(let i=4097;i<8192;i++)if(pcm[i-1]<=0&&pcm[i]>0)count++;
      return Math.abs(count*44100/4096-hz)<13 && pcm.subarray(4096).some(v=>Math.abs(v)>.01);
    },hz,{timeout:4000});
    await page.evaluate(()=>audit.input.onmidimessage({data:[0x80,60,0],timeStamp:performance.now()}));
    pitches.push(hz);
  }
  await field('Compare A').selectOption('checkpoint:'+checkpoint);
  await field('Compare B').selectOption('working');
  await press('Play A on Synth keyboard');await heard(30,220);await heard(100,330);
  await press('Play B on Synth keyboard');await heard(100,550);
  await field('Compare A').selectOption('official');await press('Play A on Synth keyboard');await heard(100,330);
  await press('Release Synth keyboard');
  const routes=await page.evaluate(()=>audit.routes);
  assert.equal(routes.length,4);assert.equal(routes[0].path,undefined);assert.equal(routes[1].path,undefined);
  assert.equal(routes[2].path,'Instruments/Bell layers');assert.equal(routes[3],null);
  assert.equal(await field('Working name').inputValue(),'Bell editing');
  assert.equal(await page.evaluate(()=>audit.hosts),1);
  assert.deepEqual(await page.evaluate(()=>audit.workspace.selectedTrack().instrument),originalTrack);
  const persisted=await page.evaluate(async id=>{
    const {openWorking}=await import('./sampler-working.js');
    const d=await openWorking(await showDirectoryPicker(),id);
    return [d.generation,d.instrument.regions[1].sample];
  },editId);
  assert.deepEqual(persisted,[2,'s550']);assert.deepEqual(errors,[]);
  await writeFile(evidence+'/history-keyboard.json',JSON.stringify({pitches,persisted,routes:routes.map(r=>r?.path||r?.libraryId||null)},null,2));
  console.log('PASS A/B keyboard compares full velocity maps from checkpoint, Working and Official at 220/330/550 Hz, then restores the keyboard and preserves the DAW track');
}finally{await browser.close();}
