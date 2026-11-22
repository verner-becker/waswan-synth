// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';

const root='.local/validation/music-lab';
await fs.mkdir(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const p=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce',contrast:'more'});
  p.setDefaultTimeout(15000);
  const errors=[];
  p.on('pageerror',error=>errors.push(error.message));
  await p.addInitScript(()=>{
    window.audit={contexts:0};
    audit.input={id:'ear-input',name:'Simulated MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.input.id,audit.input]])});
    const Audio=AudioContext;
    window.AudioContext=class extends Audio {constructor(...args){super(...args);audit.contexts++;}};
  });
  const button=name=>p.getByRole('button',{name,exact:typeof name==='string'});
  const score=p.locator('.ww-lab-score');
  const waitText=(selector,text)=>p.waitForFunction(([selector,text])=>document.querySelector(selector)?.textContent.includes(text),[selector,text]);
  const midi=(pitch,v)=>p.evaluate(([pitch,v])=>audit.input.onmidimessage({data:[0x90,pitch,v],timeStamp:performance.now()}),[pitch,v]);
  const screenshot=async name=>{
    await p.evaluate(()=>scrollTo(0,0));
    await p.screenshot({path:`${root}/${name}.png`,fullPage:true});
  };
  const hear=async()=>{
    await button('Ouvir referência').click();
    await waitText('.ww-lab-status','Exemplo concluído.');
  };
  await p.goto('http://localhost:8737/simulator/');
  await button('Music Lab').press('Enter');
  await p.getByLabel('Nível',{exact:true}).selectOption('advanced');
  await button(/Ré dórico/).click();
  await score.locator('[data-midi="71"]').waitFor();
  assert.equal(await p.getByLabel('Tonalidade',{exact:true}).locator('option').count(),1);
  await button(/Sol mixolídio/).click();
  await score.locator('[data-midi="77"]').waitFor();
  await button(/Condução de vozes/).click();
  await score.locator('[data-midi="60 64 67 69"]').waitFor();
  await button(/Duas mãos com ritmos diferentes/).click();
  await score.locator('[data-hand="RH"][data-duration="960"]').first().waitFor();
  await score.locator('[data-hand="LH"][data-duration="960"]').first().waitFor();
  await button(/Qualidade da tríade/).click();
  assert(await score.isHidden());
  assert(await p.locator('.ww-lab-keyboard').isHidden());
  assert(await button('Maior').isDisabled());
  assert(await p.locator('.ww-lab-readable').isHidden());
  await button('Iniciar áudio').click();
  await p.locator('.ww-midi-setup').getByRole('button',{name:'Connect MIDI keyboard'}).click();
  await p.waitForFunction(()=>typeof audit.input.onmidimessage==='function');
  await p.locator('.ww-midi-setup .ww-midi-continue').click();
  await p.getByLabel('Andamento',{exact:true}).selectOption('100');
  await hear();
  await button('Maior').press('Enter');
  await waitText('.ww-lab-ear-status','✓ Maior.');
  assert(await score.isHidden());
  await button('Ver partitura').press('Enter');
  await score.locator('[data-midi="60 64 67"]').waitFor();
  await p.getByText('Ler partitura em texto',{exact:true}).click();
  await waitText('.ww-lab-readable','C4, 4 tempos + E4, 4 tempos + G4, 4 tempos');
  await screenshot('w5-ear-text-score');
  await button('Outro desafio').click();
  assert(await score.isHidden());
  await hear();
  await button('Maior').click();
  await waitText('.ww-lab-ear-status','Resposta de referência · Menor.');
  await button('Ver partitura').click();
  await score.locator('[data-midi="60 63 67"]').waitFor();
  await button(/Destino da cadência/).click();
  await button('Outro desafio').click();
  await hear();
  await button('Na relativa menor').click();
  await waitText('.ww-lab-ear-status','✓ Na relativa menor.');
  await button(/Eco melódico de quatro notas/).click();
  assert(await button('Repetir eco no MIDI').isDisabled());
  await hear();
  await button('Repetir eco no MIDI').click();
  for(const pitch of [60,64,62,67]){await midi(pitch,96);await midi(pitch,0);}
  await waitText('.ww-lab-midi-feedback','4/4 notas na ordem');
  assert(await score.isHidden());
  await p.setViewportSize({width:390,height:844});
  assert(await p.locator('.ww-lab-layout').evaluate(el=>el.scrollWidth===el.clientWidth));
  await screenshot('w5-echo-mobile');
  await p.setViewportSize({width:1366,height:768});
  await p.getByLabel('Nível',{exact:true}).selectOption('all');
  await p.getByRole('button',{name:/Escala de Dó maior Mão direita/}).click();
  await button('Iniciar prática MIDI').click();
  for(const pitch of [60,62,64,65]){await midi(pitch,92);await midi(pitch,0);}
  await button('Encerrar tentativa').click();
  await button('Revisar compasso 2').click();
  assert.equal(await p.getByLabel('Trecho',{exact:true}).inputValue(),'2');
  await score.locator('[data-lab-tick="0"][data-midi="67"]').waitFor();
  assert.equal(await p.evaluate(()=>audit.contexts),1);
  assert.deepEqual(errors,[]);
  const report={result:'PASS',modalNotation:true,grandStaff:true,hiddenEarAnswers:true,qualityAndCadence:true,
    midiEcho:true,textScore:true,mobile:true,coaching:true,physicalValidation:false};
  await fs.writeFile(`${root}/browser-music-lab-w5.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
