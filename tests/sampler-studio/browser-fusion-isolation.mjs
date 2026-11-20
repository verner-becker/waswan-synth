// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';

const evidence='.local/validation/sampler-ux-4';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page=await browser.newPage();
  await page.addInitScript(()=>{
    window.audit={contexts:0,hosts:0};
    const PreviousContext=AudioContext,PreviousNode=AudioWorkletNode;
    window.AudioContext=class extends PreviousContext {
      constructor(...args){super(...args);audit.contexts++;}
    };
    window.AudioWorkletNode=class extends PreviousNode {
      constructor(...args){
        super(...args);
        if(args[1]==='obervave-smk37'){
          audit.hosts++;
          this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
        }
      }
    };
  });
  await page.goto('http://localhost:8737/simulator/?workspace=daw');
  await startSynth(page);
  await page.evaluate(async()=>{
    const {DawMix}=await import('./ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.workspace=this.w;return refresh.apply(this,args);};
  });
  await page.getByRole('button',{name:'Add MIDI track',exact:true}).click();
  const result=await page.evaluate(async()=>{
    const {initializeLibrary,importOriginal,publish,readSampleFile}=await import('./sampler-library.js');
    const {encodeSample}=await import('./sampler-offline.js');
    const {decodeWav}=await import('./sampler-wav.js');
    const {mapSample,prepareSampler}=await import('./sampler.js');
    const {captureFusion}=await import('./sampler-fusion.js');
    const {effect}=await import('./daw-fx-catalog.js');
    const {librarySetting}=await import('./tone-bank.js');
    const rate=44100,w=audit.workspace,player=w.player;
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('isolation-'+crypto.randomUUID(),{create:true});
    await initializeLibrary(root);
    await librarySetting(root,'sampleLibrary');
    const sources=[];
    for(const [index,hz] of [220,517].entries()){
      const file=encodeSample({sampleRate:rate,channels:1,
        pcm:Float32Array.from({length:rate},(_,i)=>.3*Math.sin(2*Math.PI*i*hz/rate))});
      const sample=await importOriginal(root,file,'Samples/Originals/tone-'+hz+'.wav');
      const model=mapSample(sample,60,{name:'Tone '+hz});
      model.envelope={attackMs:1,decayMs:1,sustain:1,releaseMs:2};
      const ref=await publish(root,model,{path:'Instruments/Tone-'+hz,expectedRevision:0});
      sources.push({id:'tone-'+hz,name:'Tone '+hz,instrument:await prepareSampler(player,root,ref),volume:.7,pan:index?1:-1});
    }
    await player.prepareLive(w.controller);
    const binding=()=>({project:w.controller.snapshot(),slots:[...player.slots],tracks:[...player.tracks.keys()]});
    const initial=JSON.stringify(binding());
    const opts={name:'Isolation',mode:'single',notes:[60],velocities:[110],duration:.12,release:.5,repeats:1,tail:0};
    const delay=effect('delay');
    Object.assign(delay.parameters,{mix:.5,time:.24,feedback:0});
    async function render(masterFx,extra={}){
      const {takes,report}=await captureFusion(w,root,sources,{...opts,masterFx,...extra});
      const {sample}=takes[0],wav=await decodeWav(await readSampleFile(root,sample));
      function level(hz,channel,start,end){
        let real=0,imaginary=0;
        for(let i=start;i<end;i++){
          const angle=2*Math.PI*(i-start)*hz/rate,value=wav.pcm[i*2+channel]/32768;
          real+=value*Math.cos(angle);imaginary+=value*Math.sin(angle);
        }
        return 2*Math.hypot(real,imaginary)/(end-start);
      }
      return {report,channels:wav.channels,frames:wav.frames,
        left:level(220,0,1500,4500),leftLeak:level(517,0,1500,4500),
        right:level(517,1,1500,4500),rightLeak:level(220,1,1500,4500),
        delayed:level(220,0,12000,14500),secondNote:wav.frames>20000?level(440,0,17000,20000):0,restored:JSON.stringify(binding())===initial};
    }
    const dry=await render([]),baked=await render([delay]);
    const {PPQ,uuid}=await import('./daw-project.js');
    const clip={id:uuid(),name:'Musical phrase',type:'midi',trackId:w.selectedTrack().id,
      position:{unit:'ticks',value:3*PPQ},length:PPQ,loopLength:PPQ,loop:false,
      notes:[60,72].map((pitch,i)=>({id:uuid(),pitch,velocity:100,start:i*PPQ/2,duration:PPQ/2}))};
    const texture=await render([],{mode:'texture',phrase:{clip,bpm:90}});
    const abort=new AbortController();
    let interrupted=false;
    const cancel=setTimeout(()=>abort.abort(new DOMException('Musician cancelled','AbortError')),650);
    try {await captureFusion(w,root,sources,{...opts,duration:4,signal:abort.signal});}
    catch(error){if(error.name!=='AbortError')throw error;interrupted=true;}
    finally {clearTimeout(cancel);}
    return {dry,baked,texture,interrupted,restored:JSON.stringify(binding())===initial,
      available:!player.exporting&&!w.audioExport.exporter.busy,contexts:audit.contexts,hosts:audit.hosts};
  });
  for(const render of [result.dry,result.baked]){
    assert.equal(render.channels,2);assert.equal(render.restored,true);
    assert(render.left>.02&&render.right>.02);
    assert(render.leftLeak<render.left/10&&render.rightLeak<render.right/10);
    assert.equal(render.report.clipped,0);
  }
  assert(result.baked.delayed>.02&&result.dry.delayed<.003,'Delay tail was not isolated');
  assert(result.texture.secondNote>.02&&result.texture.restored,'Second phrase note missing');
  assert(result.interrupted&&result.available&&result.restored);
  assert.equal(result.hosts,1);assert.equal(result.contexts,1);
  await writeFile(evidence+'/isolation.json',JSON.stringify(result,null,2));
  console.log('PASS Fusion dry, baked delay, stereo and cancel',result);
} finally {await browser.close();}
