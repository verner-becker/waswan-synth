// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {pcmWav} from './fixtures.mjs';
import {renderBuilderPhrase} from './builder-phrase.mjs';

const evidence='.local/validation/sampler-ux-3';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const page=await browser.newPage({viewport:{width:1440,height:960}});
page.setDefaultTimeout(10000);
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',dialog=>dialog.accept());
function recording(name,hz){
  const pcm=Int16Array.from({length:44100},(_,i)=>Math.round(12000*Math.sin(2*Math.PI*hz*i/44100)));
  return {name,mimeType:'audio/wav',buffer:Buffer.from(pcmWav(pcm,{channels:1}))};
}
try{
  await page.addInitScript(()=>{
    window.audit={live:[],hosts:0};
    audit.source={id:'builder-midi',name:'Builder test MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.source.id,audit.source]])});
    window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('Builder library',{create:true});
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet{
      constructor(...args){
        super(...args);if(args[1]!=='obervave-smk37')return;
        audit.hosts++;audit.node=this;audit.context=args[0];
        const send=this.port.postMessage.bind(this.port);
        this.port.postMessage=(message,...rest)=>{
          if(message.t==='daw-sampler-live')audit.live.push(message.ref);
          return send(message,...rest);
        };
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
  });
  await page.goto(process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/');
  await startSynth(page,{connect:true});
  await page.evaluate(async()=>{
    const {DawMix}=await import('./ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.workspace=this.w;return refresh.apply(this,args);};
  });
  const nav=id=>page.locator('[data-workspace="'+id+'"]').first().click();
  const daw=page.locator('[data-view=daw]'),studio=page.locator('[data-view=sampler]');
  const button=name=>studio.getByRole('button',{name,exact:true}),field=name=>studio.getByLabel(name,{exact:true});
  const idle=()=>page.waitForFunction(()=>!document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  const press=async name=>{await button(name).click();await idle();};
  const set=async(name,value)=>{await field(name).fill(String(value));await field(name).press('Tab');await idle();};
  await nav('daw');await daw.getByRole('button',{name:'Add MIDI track',exact:true}).click();
  await page.waitForFunction(()=>audit.workspace?.snapshot.tracks.length===1);
  const before=await page.evaluate(()=>audit.workspace.selectedTrack().instrument);
  await nav('sampler');await press('Choose Samples folder…');
  await studio.getByText('Instrument Builder',{exact:true}).click();
  await set('Builder name','Studio piano');
  const files=[recording('Piano C4 v30.wav',220),recording('Piano C4 v100.wav',330),recording('Piano C5 v30.wav',440),recording('Piano C5 v100.wav',660)];
  await field('Import builder WAVs').setInputFiles(files);
  await studio.locator('.ww-sampler-recordings li').nth(3).waitFor();await idle();
  for(const [i,file] of files.entries()){
    assert.equal(await field('Mapping root for '+file.name).inputValue(),i<2?'60':'72');
    assert.equal(await field('Mapping velocity for '+file.name).inputValue(),i%2?'100':'30');
  }
  await set('Mapping velocity for '+files[0].name,32);
  await press('Build multisample instrument');
  await studio.getByText('Articulations and keyswitches',{exact:true}).click();
  await set('Articulation ID','felt');
  await press('Apply articulation to region');
  await press('Start in this articulation');
  await press('Save Working');
  await studio.locator('.ww-sampler-mapping').screenshot({path:evidence+'/mapping.png'});
  await press('Play on Synth keyboard');
  await page.waitForFunction(()=>audit.live.length===1);
  assert.equal(await page.evaluate(()=>audit.live[0].path),undefined);
  const livePitches=[];
  const verifyNote=async(note,velocity,hz)=>{
    await page.evaluate(({note,velocity})=>{
      if(!audit.meter){audit.meter=audit.context.createAnalyser();audit.meter.fftSize=8192;audit.node.connect(audit.meter);}
      audit.source.onmidimessage({data:[0x90,note,velocity],timeStamp:performance.now()});
    },{note,velocity});
    await page.waitForFunction(expected=>{
      const pcm=new Float32Array(8192);audit.meter.getFloatTimeDomainData(pcm);
      let crossings=0;
      for(let i=4097;i<8192;i++)if(pcm[i-1]<=0&&pcm[i]>0)crossings++;
      return Math.abs(crossings*audit.context.sampleRate/4096-expected)<15&&pcm.subarray(4096).some(v=>Math.abs(v)>.003);
    },hz,{timeout:4000});
    await page.evaluate(note=>audit.source.onmidimessage({data:[0x80,note,0],timeStamp:performance.now()}),note);
  };
  for(const [note,velocity,hz] of [[60,35,220],[60,100,330],[72,35,440],[72,100,660]]){
    await verifyNote(note,velocity,hz);livePitches.push({note,velocity,hz});
  }
  assert.deepEqual(await page.evaluate(()=>audit.workspace.selectedTrack().instrument),before);
  await press('Release Synth keyboard');
  await press('Promote to Official');
  assert.deepEqual(await page.evaluate(()=>audit.workspace.selectedTrack().instrument),before);
  await press('Assign Official to selected DAW track');
  const piano=await page.evaluate(async()=>{
    const {load}=await import('./sampler-library.js'),ref=audit.workspace.selectedTrack().instrument;
    const model=await load(await showDirectoryPicker(),ref);
    return {ref,regions:model.regions.map(({root,key,velocity,articulation})=>({root,key,velocity,articulation})),initial:model.initialArticulations};
  });
  assert.equal(piano.ref.type,'sampler');assert.equal(piano.ref.revision,1);
  assert.deepEqual(piano.regions.map(region=>region.key),[[0,66],[0,66],[67,127],[67,127]]);
  assert.deepEqual(piano.regions.map(region=>region.velocity),[[1,66],[67,127],[1,65],[66,127]]);
  assert.equal(piano.initial.default,'felt');
  await renderBuilderPhrase(page);
  await press('Build kit from files');
  await set('Working name','Studio pads');await press('Promote to Official');
  const kit=await page.evaluate(async()=>{
    const {load,search,readLibrary}=await import('./sampler-library.js'),root=await showDirectoryPicker();
    const [item]=(await search(root,{kind:'kit',text:'Studio pads'})).items;
    const ref={type:'sampler',libraryId:(await readLibrary(root)).id,instrumentId:item.id,revision:item.revision,path:item.path};
    const model=await load(root,ref);return {ref,pads:model.pads.map(p=>[p.index,p.note])};
  });
  assert.deepEqual(kit.pads,[[1,36],[2,37],[3,38],[4,39]]);
  for(let i=0;i<3;i++)await studio.getByRole('button',{name:'Remove recording'}).last().click();
  await set('Builder name','Sliced bank');
  await studio.getByText('Kit from a sliced recording',{exact:true}).click();
  await press('Set 16 equal slices');
  assert.equal((await field('Slice markers (frames)').inputValue()).split(',').length,15);
  await press('Build kit from slices');
  await press('Play on Synth keyboard');
  await page.waitForFunction(()=>document.querySelector('#bankLabel').textContent==='SAMPLER KIT');
  assert.equal(await page.locator('#pads button[aria-label*="MIDI note"]').count(),16);
  await press('Release Synth keyboard');
  await press('Promote to Official');
  const split=await page.evaluate(async()=>{
    const {search,load,readLibrary}=await import('./sampler-library.js'),root=await showDirectoryPicker();
    const [item]=(await search(root,{kind:'kit',text:'Sliced bank'})).items;
    const model=await load(root,{type:'sampler',libraryId:(await readLibrary(root)).id,instrumentId:item.id,revision:item.revision,path:item.path});
    return {pads:model.pads.map(p=>p.note),frames:model.regions.map(r=>r.frames),samples:model.samples.length};
  });
  assert.deepEqual(split.pads,Array.from({length:16},(_,i)=>36+i));
  assert.equal(split.samples,1);assert.equal(split.frames[0][0],0);assert.equal(split.frames.at(-1)[1],44100);
  for(let i=1;i<16;i++)assert.equal(split.frames[i-1][1],split.frames[i][0]);
  assert.deepEqual(await page.evaluate(()=>audit.workspace.selectedTrack().instrument),piano.ref);
  assert.equal(await page.evaluate(()=>audit.hosts),1);assert.deepEqual(errors,[]);
  await page.reload();await startSynth(page,{connect:true});await nav('sampler');await idle();
  await field('Search sampler library').fill('Studio piano');await press('Search');
  await studio.getByRole('list',{name:'Library entries'}).getByRole('button',{name:'Studio piano',exact:true}).click();await idle();
  assert.equal(await field('Keyboard source').inputValue(),'official');
  await press('Play on Synth keyboard');await verifyNote(72,100,660);await press('Release Synth keyboard');
  assert.equal(await page.evaluate(()=>audit.hosts),1);assert.deepEqual(errors,[]);
  await writeFile(evidence+'/builder.json',JSON.stringify({piano,kit,split,livePitches},null,2));
  console.log('PASS builder: four WAVs, revised velocity, persistent articulation, live multisample map, explicit DAW assignment and kit.');
}catch(error){
  console.error(await page.locator('.ww-sampler-status').allTextContents());
  await page.screenshot({path:evidence+'/builder-failure.png'});throw error;
}finally{await browser.close();}
