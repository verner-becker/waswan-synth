// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import {PROGRESS_KEY} from '../web/music-lab-progress.js';

const root='.local/validation/music-lab';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.audit={contexts:0,commands:[],stamp:1000};
    audit.source={id:'lab-test-input',name:'MIDI simulado',state:'connected',async open(){},async close(){}};
    audit.access={inputs:new Map([[audit.source.id,audit.source]])};
    navigator.requestMIDIAccess=async()=>audit.access;
    const Audio=AudioContext;
    window.AudioContext=class extends Audio {
      constructor(...args){super(...args);audit.contexts++;}
    };
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet {
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        const post=this.port.postMessage.bind(this.port);
        this.port.postMessage=(m,...rest)=>{
          audit.commands.push({t:m.t,st:m.st,pitch:m.d1,value:m.d2});
          post(m,...rest);
        };
        this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});
      }
    };
  });
  const button=name=>page.getByRole('button',{name,exact:true});
  const state=value=>page.locator(`.ww-lab-midi-controls[data-state="${value}"]`).waitFor();
  const feedback=fragment=>page.waitForFunction(text=>document.querySelector('.ww-lab-midi-feedback')?.textContent.includes(text),fragment);
  const details=fragment=>page.waitForFunction(text=>document.querySelector('.ww-lab-midi-details')?.textContent.includes(text),fragment);
  const target=midi=>page.locator(`.ww-lab-note-current[data-midi="${midi}"]`).waitFor();
  const midi=(st,pitch,value,delta=20)=>page.evaluate(([st,pitch,value,delta])=>{
    audit.stamp+=delta;
    audit.source.onmidimessage({data:[st,pitch,value],timeStamp:audit.stamp});
  },[st,pitch,value,delta]);
  const progress=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),PROGRESS_KEY);
  const go=id=>page.locator(`[data-workspace="${id}"]`).click();
  const snap=async name=>{
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`${root}/${name}.png`});
  };

  await page.goto('http://localhost:8737/simulator/');
  await go('music-lab');
  assert(await button('Iniciar prática MIDI').isDisabled());
  await button('Iniciar áudio').click();
  await page.locator('.ww-midi-setup').getByRole('button',{name:'Connect MIDI keyboard'}).click();
  await page.waitForFunction(()=>typeof audit.source.onmidimessage==='function');
  await page.locator('.ww-midi-setup .ww-midi-continue').click();
  await page.waitForFunction(()=>audit.frame?.polyphony.limit===256);
  await page.getByLabel('Canal MIDI').selectOption('0');
  await button('Iniciar prática MIDI').click();
  await button('Encerrar tentativa').click();
  await feedback('Nenhuma nota MIDI recebida');
  assert.equal(await progress(),null);
  await button('Iniciar prática MIDI').click();
  await state('listening');
  await page.evaluate(()=>{audit.commands=[];});
  await midi(0x91,60,100);
  await midi(0x81,60,0);
  await target('60');
  await midi(0x90,61,100);
  await feedback('Tocou C♯4 fora do alvo');
  await page.locator('.ww-lab-key-outside').waitFor();
  await target('60');
  await snap('w2-midi-feedback-1366');
  await midi(0x80,61,0);
  await midi(0xb0,64,127);
  await midi(0x90,60,100);
  await target('62');
  await feedback('C4 correta');
  await midi(0x90,60,0,250);
  await details('pressionada por 0,25');
  await details('Pedal pressionado');
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===60));
  assert.equal((await page.evaluate(()=>audit.commands)).filter(m=>m.t==='midi'&&m.st===0x90&&m.pitch===60&&m.value>0).length,1);
  await page.evaluate(()=>{audit.commands=[];});
  await go('perf');
  await go('music-lab');
  await state('paused');
  await details('1/15 alvos mantidos');
  assert.deepEqual(await page.evaluate(()=>audit.commands),[]);
  assert(await page.evaluate(()=>audit.frame.polyphony.slots.some(v=>v.gate&&v.note===60)));
  await button('Retomar prática MIDI').click();
  await target('62');
  await midi(0xb0,64,0);
  await midi(0x90,62,100);
  await target('64');
  await page.evaluate(()=>{audit.source.state='disconnected';audit.access.onstatechange();});
  await state('paused');
  await feedback('A entrada MIDI mudou');
  assert(await button('Retomar prática MIDI').isDisabled());
  assert.equal(await progress(),null,'disconnect must not invent a result');

  await page.evaluate(()=>{audit.source.state='connected';audit.access.onstatechange();});
  await button('Configurar MIDI').click();
  await page.locator('#midiConnect').click();
  await page.waitForFunction(()=>typeof audit.source.onmidimessage==='function');
  await button('Close settings').click();
  await button('Retomar prática MIDI').click();
  await target('64');
  await midi(0xb0,123,0);
  await state('paused');
  await details('2/15 alvos mantidos');
  await button('Retomar prática MIDI').click();
  await button('Release all').click();
  await state('paused');
  await feedback('O instrumento liberou as notas');
  await button('Retomar prática MIDI').click();
  for(const pitch of [64,65,67,69,71,72,71,69,67,65,64,62,60]){
    await midi(0x90,pitch,100);
    await midi(0x80,pitch,0,100);
  }
  await state('review');
  await feedback('15/15 notas na ordem · 1 nota fora do alvo');
  const scaleKey='scale-c-major-rh-1oct@1:C';
  assert.equal((await progress()).lessons[scaleKey].history[0].summary.holdSamples,14);
  await button('Tentar novamente').click();
  await midi(0x90,60,100);
  await midi(0x80,60,0,300);
  await button('Encerrar tentativa').click();
  await feedback('1/15 notas na ordem · 14 notas faltaram');

  await button('Harmony Lab').click();
  await button('Iniciar prática MIDI').click();
  await midi(0x90,60,100);
  await midi(0x90,64,100,40);
  await midi(0x90,67,100,100);
  await feedback('Os ataques passaram de 120 ms');
  for(const pitch of [60,64,67])await midi(0x80,pitch,0);
  await midi(0x90,64,100);
  await midi(0x90,60,100,25);
  await midi(0x90,67,100,25);
  await feedback('Acorde correto');
  for(const pitch of [60,64,67])await midi(0x80,pitch,0,150);
  await state('review');
  await feedback('1/1 acorde · 1 acorde fora da janela');
  await page.locator('.ww-lab-history summary').click();
  await snap('w2-midi-review-1366');
  const saved=await progress();
  assert.equal(saved.lessons[scaleKey].attempts,2);
  assert.equal(saved.lessons['chord-c-major-rh@1:C'].history[0].summary.holdSamples,3);
  await button('Ouvir exemplo').click();
  await button('Parar').click();
  assert.deepEqual(await progress(),saved,'demo output does not enter the assessment');
  assert.equal(await page.evaluate(()=>audit.contexts),1);

  await page.reload();
  await go('music-lab');
  await page.locator('.ww-lab-history summary').getByText('Progresso local · 2 tentativas').waitFor();
  await page.locator('.ww-lab-history summary').click();
  assert.match(await page.locator('.ww-lab-history').innerText(),/15\/15 notas na ordem/);
  assert.deepEqual(await progress(),saved);
  assert.deepEqual(errors,[]);
  const report={result:'PASS',midi:'simulated',duplicateNoteOns:false,sustainSeparate:true,
    pausedOnWorkspaceDisconnectAndPanic:true,missingAndExtraNotes:true,chordWindowMs:120,
    restoredAggregateProgress:true,physicalValidation:false};
  fs.writeFileSync(`${root}/browser-music-lab-w2.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
