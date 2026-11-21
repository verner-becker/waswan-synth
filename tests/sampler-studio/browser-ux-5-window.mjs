// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {pcmWav} from './fixtures.mjs';

const evidence='.local/validation/sampler-ux-5';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const page=await browser.newPage({viewport:{width:1536,height:850}});page.setDefaultTimeout(12000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
try{
  await page.addInitScript(()=>{
    window.audit={contexts:0,hosts:0,commands:[]};
    window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('Window library',{create:true});
    audit.source={id:'linked-midi',name:'Linked MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.source.id,audit.source]])});
    const Context=AudioContext,Worklet=AudioWorkletNode;
    window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts++;}};
    window.AudioWorkletNode=class extends Worklet{
      constructor(...args){super(...args);if(args[1]!=='obervave-smk37')return;
        audit.hosts++;audit.node=this;audit.context=args[0];
        const post=this.port.postMessage.bind(this.port);
        this.port.postMessage=(m,...transfer)=>{audit.commands.push(m.t);return post(m,...transfer);};
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
  });
  await page.goto(process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/');
  await startSynth(page,{connect:true});
  const nav=id=>page.locator('[data-workspace="'+id+'"]').first().click();
  const studio=page.locator('[data-view=sampler]'),daw=page.locator('[data-view=daw]');
  const button=(where,name)=>where.getByRole('button',{name,exact:true});
  const idle=()=>page.waitForFunction(()=>!audit.editor?.hasAttribute('aria-busy'));
  await nav('daw');await button(daw,'Add MIDI track').click();
  await nav('sampler');await page.evaluate(()=>{audit.editor=document.querySelector('[data-view=sampler]');});
  await button(studio,'Choose Samples folder…').click();await idle();
  const pcm=Int16Array.from({length:44100*25},(_,i)=>Math.round(8000*Math.sin(2*Math.PI*275*i/44100)));
  await studio.getByLabel('Import WAV',{exact:true}).setInputFiles({name:'Linked tone.wav',mimeType:'audio/wav',buffer:Buffer.from(pcmWav(pcm,{channels:1}))});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Working name"]').value==='Linked tone');await idle();
  await button(studio,'Promote to Official').click();await idle();await button(studio,'Save Working').click();await idle();
  const stack=studio.locator('details').filter({has:page.locator(':scope > summary',{hasText:'Processing Stack'})}).first();
  await studio.getByText('Processing Stack',{exact:true}).click();assert.equal(await stack.evaluate(el=>el.open),false);
  const history=studio.locator('.ww-sampler-full-history');
  await history.getByText('Full history',{exact:true}).click();assert.equal(await history.evaluate(el=>el.open),true);
  await nav('perf');const perf=page.locator('[data-view=perf]');
  await button(perf,'Sampler player').click();const menu=perf.getByRole('dialog',{name:'Sampler player'});
  await menu.getByLabel('Player sound',{exact:true}).selectOption('official');await button(menu,'Play on Synth keyboard').click();
  await page.waitForFunction(()=>audit.commands.includes('daw-sampler-live'));
  assert.equal(await menu.getByRole('status').textContent(),'');
  await page.evaluate(()=>{
    audit.meter=audit.context.createAnalyser();audit.node.connect(audit.meter);
    audit.source.onmidimessage({data:[0x90,60,100],timeStamp:performance.now()});audit.at=audit.commands.length;
  });
  const audible=()=>page.waitForFunction(()=>{
    const pcm=new Float32Array(2048);audit.meter.getFloatTimeDomainData(pcm);
    let rises=0;for(let i=1;i<pcm.length;i++)if(pcm[i-1]<=0&&pcm[i]>0)rises++;
    return pcm.some(v=>Math.abs(v)>.005)&&Math.abs(rises*audit.context.sampleRate/2048-275)<30;
  });
  await audible();await menu.screenshot({path:evidence+'/compact-performance.png'});
  await button(menu,'Close player').click();await nav('sampler');
  const pending=page.context().waitForEvent('page');await button(studio,'Open Sampler in new window').click();const popup=await pending;
  popup.on('pageerror',e=>errors.push(e.message));popup.setDefaultTimeout(12000);
  const remote=popup.locator('[data-view=sampler]');await remote.waitFor();
  assert.equal(await popup.evaluate(()=>window.opener.audit.editor===document.querySelector('[data-view=sampler]')),true);
  assert.equal(await remote.getByLabel('Working name').inputValue(),'Linked tone');
  assert.equal(await remote.getByText('Processing Stack',{exact:true}).evaluate(e=>e.parentElement.open),true);
  assert.equal(await remote.locator('.ww-sampler-full-history').evaluate(el=>el.open),false);
  const remoteScope=remote.locator('details').filter({has:popup.locator('summary',{hasText:/^Oscilloscope$/})});
  await remoteScope.locator('summary').click();
  await remoteScope.getByRole('img',{name:'Shared output waveform'}).waitFor();
  await popup.waitForFunction(()=>{
    const rms=document.querySelector('.ww-sampler-studio .ww-output-monitor .ww-meter output');
    return rms && parseFloat(rms.value)>-60;
  });
  await audible();
  await nav('daw');await button(daw,'Sampler player').click();
  const dawMenu=daw.getByRole('dialog',{name:'Sampler player'});
  await dawMenu.getByLabel('Player sound',{exact:true}).selectOption('official');
  await button(dawMenu,'Assign Official to selected DAW track').click();
  await dawMenu.getByRole('status').filter({hasText:'Assigned Official r1'}).waitFor();
  await dawMenu.screenshot({path:evidence+'/compact-daw.png'});await button(dawMenu,'Close player').click();
  await popup.bringToFront();await remote.locator('.ww-sampler-waveform').screenshot({path:evidence+'/window-waveform.png'});
  await popup.evaluate(()=>window.scrollTo(0,0));
  await popup.screenshot({path:evidence+'/sampler-window.png'});
  const beforeDock=await page.evaluate(()=>audit.commands.slice(audit.at).filter(t=>['daw-sampler-live','panic','daw-stop','midi','key','store'].includes(t)));
  assert.deepEqual(beforeDock,[]);await audible();
  await popup.getByRole('button',{name:'Dock Sampler Studio',exact:true}).click();await nav('sampler');
  await studio.waitFor();assert.equal(await stack.evaluate(el=>el.open),false);
  assert.equal(await history.evaluate(el=>el.open),true);
  await audible();
  const observations=await page.evaluate(()=>({contexts:audit.contexts,hosts:audit.hosts,same:audit.editor===document.querySelector('[data-view=sampler]'),
    commands:audit.commands.slice(audit.at).filter(t=>['daw-sampler-live','panic','daw-stop','midi','key','store'].includes(t))}));
  assert.deepEqual(observations,{contexts:1,hosts:1,same:true,commands:[]});
  await page.evaluate(()=>audit.source.onmidimessage({data:[0x80,60,0],timeStamp:performance.now()}));
  await button(studio,'Release Synth keyboard').click();await idle();assert.deepEqual(errors,[]);
  await writeFile(evidence+'/linked-player.json',JSON.stringify(observations,null,2));
  console.log('PASS shared Sampler window, compact players, independent layout and sustained MIDI',observations);
}catch(error){console.error(await page.locator('.ww-sampler-status,.ww-sampler-player-menu:popover-open p').allTextContents());throw error;}
finally{await browser.close();}
