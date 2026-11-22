// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import {readProject} from '../web/daw-format.js';

const root='.local/validation/music-lab';
await fs.mkdir(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const p=await browser.newPage({viewport:{width:1536,height:1000},acceptDownloads:true});
  p.setDefaultTimeout(15000);
  const errors=[];
  p.on('pageerror',error=>errors.push(error.message));
  await p.addInitScript(()=>{
    window.audit={contexts:0,engines:0,clicks:0};
    audit.input={id:'practice-keys',name:'Simulated SMK',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.input.id,audit.input]])});
    const Audio=AudioContext;
    window.AudioContext=class extends Audio {constructor(...args){super(...args);audit.context=this;audit.contexts++;}};
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet {
      constructor(...args){
        super(...args);
        if(args[1]==='waswan-daw-click'&&args[2].processorOptions?.musicLab){
          audit.clicks++;
          audit.meter=audit.context.createAnalyser();
          this.connect(audit.meter);
        }
        if(args[1]!=='obervave-smk37')return;
        audit.engines++;
        this.port.addEventListener('message',({data:m})=>{if(m.t==='frame')audit.frame=m;});
      }
    };
  });
  const button=name=>p.getByRole('button',{name,exact:typeof name==='string'});
  const text=(selector,fragment)=>p.waitForFunction(([selector,fragment])=>document.querySelector(selector)?.textContent.includes(fragment),[selector,fragment]);
  const midi=(note,vel)=>p.evaluate(([note,vel])=>audit.input.onmidimessage({data:[0x90,note,vel],timeStamp:performance.now()}),[note,vel]);
  const waitLive=()=>p.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===74));
  await p.goto('http://localhost:8737/simulator/');
  await button('Music Lab').click();
  await button(/Improvisação pentatônica/).click();
  await button('Iniciar áudio').click();
  await p.locator('.ww-midi-setup').getByRole('button',{name:'Connect MIDI keyboard'}).click();
  await p.waitForFunction(()=>typeof audit.input.onmidimessage==='function');
  await p.locator('.ww-midi-setup .ww-midi-continue').click();
  await p.getByLabel('Acompanhamento',{exact:true}).selectOption('click');
  await button('Tocar acompanhamento').click();
  await text('.ww-lab-backing-chord','Acorde Am');
  await p.waitForFunction(()=>{
    if(!audit.meter)return false;
    const data=new Float32Array(audit.meter.fftSize);audit.meter.getFloatTimeDomainData(data);
    return data.some(x=>Math.abs(x)>.001);
  });
  assert(await p.evaluate(()=>audit.frame.polyphony.slots.every(v=>!v.gate||!v.sequenced)));
  await button('Parar acompanhamento').click();
  await p.getByLabel('Acompanhamento',{exact:true}).selectOption('harmony');
  await midi(74,110);
  await waitLive();
  await button('Tocar acompanhamento').click();
  await p.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.sequenced&&v.gate));
  await button('Silenciar acompanhamento').click();
  await p.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate||!v.sequenced));
  await waitLive();
  await button('Restaurar acompanhamento').click();
  await button('Iniciar improvisação MIDI').click();
  await midi(61,90);
  await text('.ww-lab-midi-feedback','C♯4');
  await midi(61,0);
  await button('Concluir frase').click();
  await text('.ww-lab-takes','1 ataque');
  assert.equal(await button('Salvar tomada A para DAW').count(),0);
  assert.equal(await p.evaluate(()=>localStorage.getItem('waswan-music-lab-progress-v1')),null);

  await p.getByLabel('Gravar notas desta frase').check();
  await button('Improvisar outra frase').click();
  for(const [note,velocity] of [[58,71],[62,93],[64,77]]){
    await midi(note,velocity);
    await p.waitForTimeout(65);
    await midi(note,0);
  }
  await button('Concluir frase').click();
  await text('.ww-lab-takes','Tomada B');
  await p.evaluate(()=>scrollTo(0,0));
  await p.screenshot({path:`${root}/w4-improvisation-1536.png`,fullPage:true});
  const download=p.waitForEvent('download');
  await button('Salvar tomada B para DAW').click();
  const file=await download;
  assert.match(file.suggestedFilename(),/\.wsproj$/);
  const copy=await readProject(new Blob([await fs.readFile(await file.path())]));
  assert.equal(copy.project.version,4);
  assert.equal(copy.project.ppq,960);
  assert.deepEqual(copy.project.clips[0].notes.map(n=>[n.pitch,n.velocity]),[[58,71],[62,93],[64,77]]);
  await button('Ouvir tomada B').click();
  await text('.ww-lab-status','Escuta concluída.');
  await waitLive();
  await midi(74,0);
  await button('Harmony Lab').click();
  await button(/Acompanhamento pop/).click();
  await p.getByLabel('Mãos',{exact:true}).selectOption('RH');
  assert(await button('Iniciar prática MIDI').isEnabled());
  await p.getByLabel('Acompanhamento',{exact:true}).selectOption('bass');
  await button('Tocar acompanhamento').click();
  await text('.ww-lab-backing-chord','Acorde C');
  await button('Iniciar prática MIDI').click();
  await midi(60,100);await midi(64,95);await midi(67,91);
  await text('.ww-lab-midi-feedback','Acorde correto');
  await midi(60,0);await midi(64,0);await midi(67,0);
  await button('Encerrar tentativa').click();
  await button('Parar acompanhamento').click();
  assert.deepEqual(await p.evaluate(()=>({contexts:audit.contexts,engines:audit.engines,clicks:audit.clicks})),{contexts:1,engines:1,clicks:1});
  assert.deepEqual(errors,[]);
  const report={result:'PASS',clickAudible:true,sameHost:true,heldLiveKeySurvives:true,chromaticAccepted:true,
    optInNotes:true,independentDawCopy:true,alternateHandWithBass:true,physicalValidation:false};
  await fs.writeFile(`${root}/browser-music-lab-w4.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
