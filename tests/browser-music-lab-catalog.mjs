// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';

const root='.local/validation/music-lab';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const p=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  p.setDefaultTimeout(12000);
  const errors=[];
  p.on('pageerror',error=>errors.push(error.message));
  await p.addInitScript(()=>{
    window.audit={clock:500,cycles:[],contexts:0};
    audit.input={id:'smk-simulated',name:'SMK-37 simulated',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.input.id,audit.input]])});
    const Audio=AudioContext;
    window.AudioContext=class extends Audio {constructor(...args){super(...args);audit.contexts++;}};
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet {
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        this.port.addEventListener('message',({data:m})=>{
          if(m.t==='frame')audit.frame=m;
          if(m.t==='music-lab-state'&&m.playing)audit.cycles.push(m.cycle);
        });
      }
    };
  });
  const button=name=>p.getByRole('button',{name,exact:typeof name==='string'});
  const score=p.locator('.ww-lab-score');
  const note=(pitch,tick)=>score.locator(`[data-midi="${pitch}"][data-lab-tick="${tick}"]`);
  const input=(pitch,on=true,delta=20)=>p.evaluate(([pitch,on,delta])=>{
    audit.clock+=delta;
    audit.input.onmidimessage({data:[on?0x90:0x80,pitch,on?100:0],timeStamp:audit.clock});
  },[pitch,on,delta]);
  const waitText=(selector,text)=>p.waitForFunction(([selector,text])=>document.querySelector(selector)?.textContent.includes(text),[selector,text]);
  const snap=async(name)=>{await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${root}/${name}.png`});};
  await p.goto('http://localhost:8737/simulator/');
  await button('Music Lab').click();
  await note(60,0).waitFor();
  assert.equal(await p.getByLabel('Tonalidade').locator('option').count(),12);
  await button(/Escala de Sol maior/).click();
  await note(78,2880).waitFor();
  await button(/Escala de Fá maior/).click();
  await note(70,1440).waitFor();
  await button(/Escala de Lá menor harmônica/).click();
  await p.getByLabel('Tonalidade').selectOption('D#');
  await note(62,2880).waitFor();
  await snap('w3-minor-notation');
  await button('Harmony Lab').click();
  await button(/primeira inversão/).click();
  await note('64 67 72',0).waitFor();
  await waitText('.ww-lab-meta','C/E');
  await button(/Tétrade diminuta/).click();
  await note('60 63 66 69',0).waitFor();
  await waitText('.ww-lab-position','B𝄫4');
  await button('Technique & Expression').click();
  await p.getByLabel('Nível',{exact:true}).selectOption('coordination');
  await note(48,0).waitFor();
  await note(60,0).waitFor();
  assert.equal(await note(48,0).getAttribute('data-duration'),'1920');
  assert.equal(await note(60,0).getAttribute('data-duration'),'480');
  assert.equal(await note(48,0).getAttribute('data-onset-x'),await note(60,0).getAttribute('data-onset-x'));
  await button('Iniciar áudio').click();
  await p.locator('.ww-midi-setup').getByRole('button',{name:'Connect MIDI keyboard'}).click();
  await p.waitForFunction(()=>typeof audit.input.onmidimessage==='function');
  await p.locator('.ww-midi-setup .ww-midi-continue').click();
  await waitText('.ww-lab-midi-availability','Calibre o alcance');
  assert(await button('Iniciar prática MIDI').isDisabled());
  const calibrate=async(min,max)=>{
    await button('Calibrar alcance').click();
    await input(min);
    await input(min,false);
    await waitText('.ww-lab-range','Agora toque');
    await input(max);
    await input(max,false);
    await button('Confirmar alcance').click();
  };
  await calibrate(60,76);
  await waitText('.ww-lab-midi-availability','estude cada mão separadamente');
  assert(await button('Iniciar prática MIDI').isDisabled());
  await p.getByLabel('Mãos',{exact:true}).selectOption('RH');
  await note(67,1440).waitFor();
  assert.equal(await score.locator('[data-hand="LH"]').count(),0);
  assert(await button('Iniciar prática MIDI').isEnabled());
  await p.getByLabel('Mãos',{exact:true}).selectOption('BOTH');
  await calibrate(60,96);
  await button('Subir 1 oitava').click();
  await note(60,0).waitFor();
  await note(72,0).waitFor();
  await button('Iniciar prática MIDI').click();
  await input(60);
  await input(72,true,90);
  await input(72,false);
  await waitText('.ww-lab-position','Mantenha ME C4');
  await snap('w3-grand-staff-1366');
  await input(74);
  await input(74,false);
  await input(60,false);
  await input(76);
  await waitText('.ww-lab-midi-feedback','Mantenha C4 no baixo');
  await input(76,false);
  await input(60);
  await input(76);
  await input(76,false);
  await input(79);
  await input(79,false);
  await input(60,false);
  await waitText('.ww-lab-midi-feedback','4/4 passos na ordem');
  await button('Melody Lab').click();
  await p.getByRole('button',{name:/Escala de Dó maior Mão direita/}).click();
  await p.getByLabel('Trecho',{exact:true}).selectOption('4');
  await note(60,960).waitFor();
  assert.equal(await score.locator('[data-lab-tick]').count(),3);
  await p.getByLabel('Andamento',{exact:true}).selectOption('100');
  await p.getByLabel('Repetir exemplo').check();
  await button('Ouvir exemplo').click();
  await p.waitForFunction(()=>audit.cycles.some(cycle=>cycle>=1));
  await button('Parar').click();
  await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate||!v.sequenced));
  assert.equal(await p.evaluate(()=>audit.contexts),1);
  assert.deepEqual(errors,[]);
  const report={result:'PASS',transposition:true,inversions:true,grandStaff:true,calibratedRange:true,
    separatedHands:true,retainedBass:true,clipLoop:true,contexts:1,midi:'simulated',physicalValidation:false};
  fs.writeFileSync(`${root}/browser-music-lab-w3.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
