// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/daw-mvp-wave-9';
const seconds=Number(process.env.DAW_CAPTURE_SECONDS||10);
assert(Number.isInteger(seconds)&&seconds>=1&&seconds<=1200);
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});

  await page.addInitScript(()=>{
    window.audit={contexts:0,dsp:[],progress:[],errors:[]};
    const Context=AudioContext;
    window.AudioContext=class extends Context{constructor(...args){super(...args);audit.context=this;audit.contexts++;}};
    const Node=AudioWorkletNode;
    window.AudioWorkletNode=class extends Node{
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        audit.node=this;
        this.port.addEventListener('message',({data:m})=>{
          if(m.t==='frame')audit.frame=m;
          if(m.t==='error')audit.errors.push(m.message);
          if(m.t==='dsp-window')audit.dsp.push(m);
        });
      }
    };
    navigator.mediaDevices.getUserMedia=async()=>{
      audit.constant=audit.context.createConstantSource();
      audit.constant.offset.value=.125;
      const target=audit.context.createMediaStreamDestination();
      audit.constant.connect(target);audit.constant.start();
      return target.stream;
    };
  });
  await page.goto('http://localhost:8737/simulator/?workspace=daw');
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.waitForFunction(()=>audit.frame?.ms>5000);
  await page.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
  await page.evaluate(async()=>{
    const {DawMix}=await import('/simulator/ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.w=this.w;return refresh.apply(this,args);};
  });
  const daw=page.locator('.ww-daw');
  await daw.getByRole('button',{name:'Add audio track',exact:true}).click();
  await page.evaluate(seconds=>{
    const w=audit.w,end=seconds*2*960;
    w.controller.command('batch',{commands:[
      {type:'project.update',payload:{length:end,transport:{loop:true,start:0,end}}},
      {type:'track.update',payload:{id:w.selected,changes:{arm:true}}}
    ]});
    w.recorder.settings.countIn=0;w.recorder.settings.click=true;
    audit.node.port.postMessage({t:'dsp-control',action:'start',session:'daw-recording-load'});
  },seconds);
  const started=Date.now();
  await daw.getByRole('button',{name:'Record DAW',exact:true}).click();
  await page.waitForFunction(()=>audit.w.recorder.state==='recording',null,{timeout:25000});
  console.log('Recording started. Target frames: '+seconds*44100);
  const meter=setInterval(async()=>{
    try{console.log(await page.evaluate(()=>Math.floor(audit.context.currentTime-audit.w.recorder.meta.startFrame/44100)+' seconds of audio clock'));}catch{}
  },60000);
  try{await page.waitForFunction(()=>!audit.w.recorder.busy,null,{timeout:seconds*1000+45000,polling:1000});}
  finally{clearInterval(meter);}
  const wallMs=Date.now()-started;
  const report=await page.evaluate(async seconds=>{
    const w=audit.w,clip=w.snapshot.clips.find(c=>c.type==='audio');
    if(!clip)throw Error(w.status.textContent);
    const audio=w.controller.assets.get(clip.assetId),frames=seconds*44100;
    if(audio.size!==44+frames*4)throw Error('Unexpected WAV byte length '+audio.size);
    const header=new DataView(await audio.slice(0,44).arrayBuffer());
    if(header.getUint32(24,true)!==44100||header.getUint32(40,true)!==frames*4)throw Error('Invalid capture header');
    let wrong=0,peak=0;
    for(let at=44;at<audio.size;at+=1024*1024){
      const pcm=new Int16Array(await audio.slice(at,Math.min(audio.size,at+1024*1024)).arrayBuffer());
      for(const sample of pcm){peak=Math.max(peak,Math.abs(sample));if(sample!==4096)wrong++;}
    }
    const {readTake}=await import('/simulator/daw-take-store.js');
    const recovered=await readTake(w.recorder.meta.id);
    const tail=await recovered.audio.slice(-4096).arrayBuffer();
    return {frames:clip.frames,bytes:audio.size,wrong,peak,checkpointFrames:recovered.meta.frames,
      checkpointTailIntact:new Int16Array(tail).every(sample=>sample===4096),
      contexts:audit.contexts,contextState:audit.context.state,dsp:audit.dsp.map(m=>({stats:m.stats,measurement:m.measurement})),errors:audit.errors};
  },seconds);
  assert.equal(report.frames,seconds*44100);assert.equal(report.wrong,0);
  assert.equal(report.checkpointFrames,report.frames);assert(report.checkpointTailIntact);
  assert.equal(report.contexts,1);assert.deepEqual(report.errors,[]);assert.deepEqual(errors,[]);
  const result={result:'PASS',seconds,wallMs,...report,physicalValidation:false};
  fs.writeFileSync(`${root}/recording-load-${seconds}s.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({result:'PASS',seconds,frames:report.frames,bytes:report.bytes,wallMs,wrong:report.wrong,dspWindows:report.dsp.length}));
}finally{await browser.close();}
