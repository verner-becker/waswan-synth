// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {pcmWav} from './fixtures.mjs';

const evidence='.local/validation/sampler-ux-4';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',d=>d.accept());
function file(name,hz){
  const pcm=Int16Array.from({length:88200},(_,i)=>Math.round(9500*Math.sin(2*Math.PI*hz*i/44100)));
  return {name:name+'.wav',mimeType:'audio/wav',buffer:Buffer.from(pcmWav(pcm,{channels:1}))};
}
try{
  await page.addInitScript(()=>{
    window.audit={hosts:0,live:[],fusion:[]};
    window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('Fusion library',{create:true});
    audit.input={id:'fusion-test',name:'Fusion test MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.input.id,audit.input]])});
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet{
      constructor(...args){super(...args);if(args[1]!=='obervave-smk37')return;
        audit.hosts++;audit.node=this;audit.context=args[0];
        const post=this.port.postMessage.bind(this.port);
        this.port.postMessage=(m,...rest)=>{
          if(m.t==='daw-sampler-live')audit.live.push(m.ref);
          if(audit.watchInput&&['daw-live-note','daw-live-pedal','midi','panic','key'].includes(m.t))audit.fusion.push(m);
          return post(m,...rest);
        };
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
  });
  await page.goto(process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/');
  await startSynth(page,{connect:true});await page.locator('[data-workspace=sampler]').click();
  const pane=page.locator('[data-view=sampler]'),field=name=>pane.getByLabel(name,{exact:true});
  const b=name=>pane.getByRole('button',{name,exact:true});
  const idle=()=>page.waitForFunction(()=>!document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  const press=async name=>{await b(name).click();await idle();};
  const set=async(name,value)=>{await field(name).fill(String(value));await field(name).press('Tab');await idle();};
  await press('Choose Samples folder…');
  await pane.getByText('Sound Fusion',{exact:true}).click();
  for(const [name,hz] of [['Fusion low',220],['Fusion high',330]]){
    await field('Import WAV').setInputFiles(file(name,hz));
    await page.waitForFunction(name=>document.querySelector('[aria-label="Working name"]').value===name,name);
    await press('Promote to Official');await press('Add Official sampler');
  }
  await set('Fusion low · r1 Pan',-1);await set('Fusion high · r1 Pan',1);
  await press('Listen to Fusion');
  await page.waitForFunction(()=>document.querySelector('.ww-sampler-fusion .ww-sampler-status').textContent.includes('owns the Synth keyboard'));
  await page.evaluate(()=>{
    audit.watchInput=true;
    audit.midi=(...data)=>audit.input.onmidimessage({data,timeStamp:performance.now()});
    audit.midi(0x92,60,101);
  });
  await page.waitForFunction(()=>audit.fusion.filter(m=>m.t==='daw-live-note'&&m.velocity===101).length===2);
  const liveParts=await page.evaluate(()=>audit.fusion.filter(m=>m.t==='daw-live-note').map(m=>m.part));
  assert.equal(new Set(liveParts).size,2);
  await page.evaluate(()=>audit.midi(0xb2,64,127));
  await page.waitForFunction(()=>audit.fusion.filter(m=>m.t==='daw-live-pedal'&&m.down===1).length===2);
  await page.locator('[data-workspace=perf]').first().click();
  await page.locator('[data-workspace=sampler]').first().click();
  assert.equal(await page.evaluate(()=>audit.fusion.filter(m=>m.t==='daw-live-note'&&!m.velocity).length),0);
  await page.evaluate(()=>{audit.midi(0x82,60,0);audit.midi(0xb2,64,0);});
  await page.waitForFunction(()=>audit.fusion.filter(m=>m.t==='daw-live-pedal'&&m.down===0).length===2);
  const routed=await page.evaluate(()=>audit.fusion.map(({t,part,note,velocity,exportToken,token})=>({t,part,note,velocity,authorized:!!token&&token===exportToken})));
  assert(routed.every(m=>m.authorized));
  assert.deepEqual(routed.filter(m=>m.t==='daw-live-note'&&!m.velocity).map(m=>m.part),liveParts);
  await press('Release Fusion keyboard');
  await page.evaluate(()=>{audit.watchInput=false;});
  await set('Fusion name','Two source print');
  await set('Note duration (s)',.5);await set('Release window (s)',.25);
  await press('Capture Fusion WAV');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Working name"]').value==='Two source print');
  assert.equal(await page.evaluate(()=>audit.live.length),0);
  const result=await page.evaluate(async()=>{
    const {search,inspectSample,readSampleFile}=await import('./sampler-library.js');
    const {decodeWav}=await import('./sampler-wav.js'),root=await showDirectoryPicker();
    const [entry]=(await search(root,{kind:'sample',text:'Two source print'})).items;
    const sample=await inspectSample(root,entry.path,{verify:true}),file=await readSampleFile(root,sample);
    const {pcm,channels,sampleRate,frames}=await decodeWav(file);
    const amplitudes=[];
    for(let c=0;c<2;c++){
      const at=hz=>{
        let re=0,im=0;
        for(let i=0;i<4410;i++){const x=pcm[(i+4096)*channels+c],phi=2*Math.PI*hz*i/sampleRate;re+=x*Math.cos(phi);im+=x*Math.sin(phi);}
        return Math.hypot(re,im)/2205;
      };
      amplitudes.push([at(220),at(330)]);
    }
    return {name:sample.name,frames,channels,amplitudes,identity:sample.sha256,sourceCount:sample.provenance.fusion.sources.length,
      wav:await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(file);})};
  });
  assert.equal(result.channels,2);assert.equal(result.sourceCount,2);assert(result.frames>=33000&&result.frames<34000);
  assert(result.amplitudes[0][0]>1000);assert(result.amplitudes[1][1]>1000);
  assert(result.amplitudes[0][1]<.05*result.amplitudes[0][0]);assert(result.amplitudes[1][0]<.05*result.amplitudes[1][1]);
  await pane.locator('.ww-sampler-fusion').screenshot({path:evidence+'/sources.png'});
  await press('Remove Fusion low · r1');await press('Remove Fusion high · r1');
  await press('Save Working');await press('Promote to Official');
  await field('Keyboard source').selectOption('official');await press('Play on Synth keyboard');
  await page.evaluate(()=>{
    const split=audit.context.createChannelSplitter(2);audit.node.connect(split,0);
    audit.meters=[0,1].map(c=>{const a=audit.context.createAnalyser();a.fftSize=4096;split.connect(a,c);return a;});
    audit.input.onmidimessage({data:[0x90,60,100],timeStamp:performance.now()});
  });
  await page.waitForFunction(()=>audit.meters.every((meter,c)=>{
    const x=new Float32Array(4096);meter.getFloatTimeDomainData(x);let crossings=0;
    for(let i=2049;i<4096;i++)if(x[i-1]<=0&&x[i]>0)crossings++;
    return x.subarray(2048).some(v=>Math.abs(v)>.003)&&Math.abs(crossings*audit.context.sampleRate/2048-[220,330][c])<24;
  }));
  await page.evaluate(()=>audit.input.onmidimessage({data:[0x80,60,0],timeStamp:performance.now()}));await press('Release Synth keyboard');
  await press('Restore source snapshots');
  assert.equal(await field('Fusion low · r1 Pan').inputValue(),'-1');
  assert.equal(await field('Fusion high · r1 Pan').inputValue(),'1');
  await field('Fusion capture mode').selectOption('multi');
  await set('Multisample roots (MIDI)','60-72/12');await set('Multisample velocities','45, 100');
  await set('Repetitions per zone',2);await set('Note duration (s)',.12);await set('Release window (s)',.04);
  await set('Fusion name','Eight captures');
  await press('Capture Fusion multisample');
  assert.equal(await field('Working name').inputValue(),'Eight captures');
  await press('Promote to Official');
  const multi=await page.evaluate(async()=>{
    const {load,search,readLibrary}=await import('./sampler-library.js'),root=await showDirectoryPicker();
    const [entry]=(await search(root,{kind:'instrument',text:'Eight captures'})).items;
    const model=await load(root,{type:'sampler',libraryId:(await readLibrary(root)).id,instrumentId:entry.id,revision:entry.revision,path:entry.path});
    return {roots:[...new Set(model.regions.map(r=>r.root))],regions:model.regions.length,samples:model.samples.length,variations:model.variations.length};
  });
  assert.deepEqual(multi,{roots:[60,72],regions:8,samples:8,variations:4});
  assert.equal(await page.evaluate(()=>audit.hosts),1);assert.deepEqual(errors,[]);
  const {wav,...report}=result;
  await writeFile(evidence+'/fusion-print.wav',Buffer.from(wav,'base64'));
  await writeFile(evidence+'/fusion-print.json',JSON.stringify({...report,multi},null,2));
  console.log('PASS two sampler sources captured in stereo from the shell and played without active sources',report);
}catch(error){
  console.error(await page.locator('.ww-sampler-fusion .ww-sampler-status,.ww-sampler-studio>.ww-sampler-status').allTextContents());
  await page.screenshot({path:evidence+'/fusion-failure.png'});throw error;
}finally{await browser.close();}
