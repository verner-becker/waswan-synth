// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';

const root='.local/validation/music-lab';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);
  const errors=[],remote=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith('http://localhost:8737/'))remote.push(request.url());});
  await page.addInitScript(()=>{
    window.audit={contexts:0,ready:0,sent:[],states:[],permission:false};
    audit.source={id:'simulated-lab-controller',name:'Simulated MIDI',state:'connected',async open(){},async close(){}};
    audit.access={inputs:new Map([[audit.source.id,audit.source]])};
    navigator.requestMIDIAccess=async()=>{
      if(!audit.permission)throw new DOMException('Denied for browser test','NotAllowedError');
      return audit.access;
    };
    const Audio=AudioContext;
    window.AudioContext=class extends Audio {
      constructor(options){super(options);audit.context=this;audit.contexts++;}
    };
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet {
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        audit.node=this;
        const post=this.port.postMessage.bind(this.port);
        this.port.postMessage=(message,...rest)=>{
          audit.sent.push({t:message.t,token:message.token});
          post(message,...rest);
        };
        this.port.addEventListener('message',({data:m})=>{
          if(m.t==='frame')audit.frame=m;
          if(m.t==='ready')audit.ready++;
          if(m.t==='music-lab-state')audit.states.push(m);
        });
      }
    };
  });
  const button=name=>page.getByRole('button',{name,exact:true});
  const go=id=>page.locator(`[data-workspace="${id}"]`).click();
  const lab=page.locator('[data-view="music-lab"]');
  const score=lab.getByRole('region',{name:'Partitura'});
  const notes=()=>score.locator('[data-lab-tick]').evaluateAll(elements=>elements.map(el=>el.dataset.midi));
  const capture=async(name,fullPage=false)=>{
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`${root}/${name}.png`,fullPage});
  };
  const token=()=>page.evaluate(()=>audit.sent.findLast(m=>m.t==='music-lab-start').token);
  const midi=(...data)=>page.evaluate(data=>audit.source.onmidimessage({data,timeStamp:performance.now()}),data);
  const waitDemoGates=pitches=>page.waitForFunction(pitches=>{
    const gates=audit.frame.polyphony.slots.filter(v=>v.sequenced&&v.gate);
    return String([...new Set(gates.map(v=>v.note))].sort((a,b)=>a-b))===String(pitches);
  },pitches);

  await page.goto('http://localhost:8737/simulator/');
  await button('Music Lab').press('Enter');
  await score.locator('[data-lab-tick="6720"]').waitFor();
  assert.equal(await button('Music Lab').evaluate(el=>el.matches(':focus-visible')),true);
  assert.deepEqual(await notes(),['60','62','64','65','67','69','71','72','71','69','67','65','64','62','60']);
  assert.match(await lab.locator('.ww-lab-goal').textContent(),/subindo e descendo/);
  assert.match(await lab.locator('.ww-lab-meta').textContent(),/Clave de sol/);
  assert.equal(await score.locator('[data-lab-tick="0"] text').textContent(),'1');
  assert.equal(await button('Ouvir exemplo').isDisabled(),true);
  assert.equal(await page.evaluate(()=>audit.contexts),0);
  await button('Configurar MIDI').click();
  await page.locator('#midiConnect').click();
  await page.waitForFunction(()=>/MIDI permission denied/.test(document.querySelector('#midiStatus').textContent));
  await button('Close settings').click();
  assert.match(await lab.locator('.ww-lab-system').innerText(),/Sem MIDI/);
  await capture('w1-melody-1366');
  const width=await score.locator('svg').evaluate(svg=>svg.getBoundingClientRect().width);
  await lab.getByLabel('Zoom da pauta').selectOption('200');
  assert.equal(await score.locator('svg').evaluate(svg=>svg.getBoundingClientRect().width),width*2);
  await lab.getByLabel('Zoom da pauta').selectOption('100');

  await page.setViewportSize({width:1920,height:1080});
  await lab.getByRole('button',{name:/Escala de Dó maior Mão esquerda/}).click();
  await score.locator('[data-lab-tick="0"][data-midi="48"]').waitFor();
  assert.match(await lab.locator('.ww-lab-meta').textContent(),/Clave de fá/);
  assert.deepEqual((await score.locator('[data-lab-tick] text').allTextContents()).slice(0,8),['5','4','3','2','1','3','2','1']);
  await button('Praticar sozinho').press('Enter');
  await button('Avançar').press('Enter');
  assert.match(await lab.locator('.ww-lab-position').textContent(),/D3 · dedo 4/);
  assert.equal(await lab.getAttribute('data-lab-state'),'practice');
  await capture('w1-left-hand-1920');
  await lab.getByLabel('Tonalidade').selectOption('F');
  await score.locator('[data-lab-tick="1440"][data-midi="58"]').waitFor();
  assert.equal(await score.locator('[data-lab-tick] text').count(),0);
  await lab.getByLabel('Tonalidade').selectOption('G');
  await score.locator('[data-lab-tick="2880"][data-midi="54"]').waitFor();
  await lab.getByLabel('Tonalidade').selectOption('C');
  await score.locator('[data-lab-tick="0"][data-midi="48"]').waitFor();
  await lab.getByLabel('Dedilhado').uncheck();
  await page.waitForFunction(()=>document.querySelectorAll('.ww-lab-score [data-lab-tick] text').length===0);
  await lab.getByLabel('Dedilhado').check();

  await button('Iniciar áudio').click();
  await page.locator('.ww-midi-setup .ww-midi-continue').click();
  await page.waitForFunction(()=>audit.frame?.polyphony.limit===256);
  await page.evaluate(()=>{
    audit.analyser=audit.context.createAnalyser();
    audit.node.connect(audit.analyser,0);
  });
  await lab.getByLabel('Andamento').selectOption('100');
  await button('Ouvir exemplo').click();
  const first=await token();
  await waitDemoGates([48]);
  await page.waitForFunction(()=>document.querySelector('.ww-lab-note-current')?.dataset.midi==='50');
  await button('Parar').click();
  await waitDemoGates([]);
  assert.equal(await score.locator('.ww-lab-note-current').count(),0);

  await button('Harmony Lab').click();
  await score.locator('[data-lab-tick="0"][data-midi="60 64 67"]').waitFor();
  assert.deepEqual(await notes(),['60 64 67']);
  await button('Praticar sozinho').press('Enter');
  await button('Concluir').press('Enter');
  assert.equal(await lab.getAttribute('data-lab-state'),'complete');
  await page.setViewportSize({width:2560,height:1080});
  await button('Ouvir exemplo').click();
  await waitDemoGates([60,64,67]);
  await page.evaluate(token=>audit.node.port.postMessage({t:'music-lab-stop',token}),first);
  assert.equal(await lab.locator('.ww-lab-key-current').count(),3);
  const peak=await page.evaluate(()=>{
    const samples=new Float32Array(audit.analyser.fftSize);
    audit.analyser.getFloatTimeDomainData(samples);
    return Math.max(...samples.map(Math.abs));
  });
  assert(peak>0.001,'the actual shared Synth output is audible');
  await capture('w1-harmony-ultrawide');
  await lab.locator('.ww-lab-status').getByText('Exemplo concluído.',{exact:true}).waitFor();
  await waitDemoGates([]);

  await page.evaluate(()=>{audit.permission=true;});
  await button('Configurar MIDI').click();
  await page.locator('#midiConnect').click();
  await page.waitForFunction(()=>typeof audit.source.onmidimessage==='function');
  await button('Close settings').click();
  await page.waitForFunction(()=>document.querySelector('.ww-lab-system').textContent.includes('MIDI conectado'));
  await go('perf');
  await midi(0xb0,64,127);
  await midi(0x90,60,100);
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===60));
  await midi(0x90,60,0);
  await page.waitForFunction(()=>audit.frame.polyphony.midiSustain);
  await page.evaluate(()=>{audit.sent=[];audit.programs=JSON.stringify(audit.frame.programs);audit.part=audit.frame.track;});
  await go('music-lab');
  await go('tones');
  await go('music-lab');
  assert.deepEqual(await page.evaluate(()=>audit.sent),[],'workspace navigation sends no note-offs or panic');
  await button('Ouvir exemplo').click();
  await waitDemoGates([60,64,67]);
  await go('perf');
  await waitDemoGates([]);
  const continuity=await page.evaluate(()=>({
    contexts:audit.contexts,ready:audit.ready,samePrograms:JSON.stringify(audit.frame.programs)===audit.programs,
    samePart:audit.frame.track===audit.part,sustain:audit.frame.polyphony.midiSustain,
    live:audit.frame.polyphony.slots.some(v=>v.gate&&!v.sequenced&&v.note===60),
    commands:audit.sent.map(m=>m.t)
  }));
  assert.deepEqual(continuity,{contexts:1,ready:1,samePrograms:true,samePart:true,sustain:true,live:true,commands:['music-lab-start','music-lab-stop']});
  await midi(0xb0,64,0);
  await page.waitForFunction(()=>audit.frame.polyphony.slots.every(v=>!v.gate));

  await go('music-lab');
  await button('Ouvir exemplo').click();
  await waitDemoGates([60,64,67]);
  await midi(0xb0,123,0);
  await waitDemoGates([]);
  await lab.locator('.ww-lab-status').getByText('Prévia interrompida pelo instrumento.',{exact:true}).waitFor();
  await page.evaluate(()=>{audit.source.state='disconnected';audit.access.onstatechange({port:audit.source});});
  await page.waitForFunction(()=>document.querySelector('.ww-lab-system').textContent.includes('Sem MIDI'));

  await page.setViewportSize({width:390,height:844});
  await button('Melody Lab').click();
  await score.locator('[data-lab-tick="6720"]').waitFor();
  assert(await score.evaluate(el=>el.scrollWidth>el.clientWidth),'mobile score scrolls within its region');
  const bounds=await lab.boundingBox();
  assert(bounds.x+bounds.width<=390,'lesson fits the mobile viewport');
  await capture('w1-mobile-390',true);
  assert.deepEqual(remote,[]);
  assert.deepEqual(errors,[]);
  const report={result:'PASS',browser:'Chrome headless',midi:'simulated',peak,continuity,physicalValidation:false};
  fs.writeFileSync(`${root}/browser-music-lab.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
