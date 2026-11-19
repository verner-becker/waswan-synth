// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root='.local/validation/synth-output';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:2});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.audit={contexts:0,commands:[]};
    const AC=AudioContext;
    window.AudioContext=class extends AC {
      constructor(options){super(options);audit.contexts++;}
      createAnalyser(){const node=super.createAnalyser();audit.analyser??=node;return node;}
    };
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=class extends Worklet {
      constructor(...args){
        super(...args);
        if(args[1]!=='obervave-smk37')return;
        audit.instrument=this;
        const post=this.port.postMessage.bind(this.port);
        this.port.postMessage=(message,...rest)=>{audit.commands.push(message.t);post(message,...rest);};
        this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
      }
    };
    audit.waveHeight=()=>{
      const canvas=document.querySelector('.ww-scope');
      const {width,height}=canvas;
      const {data}=canvas.getContext('2d').getImageData(0,0,width,height);
      let top=height,bottom=-1;
      for(let y=0;y<height;y++){
        for(let x=0;x<width;x++){
          const i=(y*width+x)*4;
          if(data[i]===39&&data[i+1]===227&&data[i+2]===221){
            top=Math.min(top,y);
            bottom=y;
            break;
          }
        }
      }
      return Math.max(0,bottom-top)/height;
    };
    audit.spectralPeak=(left,right)=>{
      const canvas=document.querySelector('.ww-scope');
      const {width,height}=canvas;
      const start=Math.floor(width*left),columns=Math.max(1,Math.floor(width*right)-start);
      const {data}=canvas.getContext('2d').getImageData(start,0,columns,height);
      let peak=0,row=0;
      for(let y=0;y<height;y++){
        let sum=0;
        for(let x=0;x<columns;x++)sum+=data[(y*columns+x)*4+1];
        if(sum>peak){peak=sum;row=y;}
      }
      return {position:row/height,intensity:peak/columns};
    };
  });
  await page.goto('http://localhost:8737/simulator/');
  const monitor=page.locator('.ww-output-monitor');
  const oscilloscope=monitor.getByRole('button',{name:'Oscilloscope',exact:true});
  const spectrogram=monitor.getByRole('button',{name:'Spectrogram',exact:true});
  const zoom=monitor.getByLabel('Y zoom',{exact:true});
  assert.equal(await zoom.inputValue(),'auto');
  const canvas=monitor.getByRole('img');
  const layout=await canvas.evaluate(node=>({height:node.clientHeight,width:node.clientWidth,drawingWidth:node.width}));
  assert(layout.height>=114);
  await page.waitForFunction(()=>{const node=document.querySelector('.ww-scope');return node.width===node.clientWidth*devicePixelRatio;});

  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.getByRole('button',{name:'Use keyboard & pads',exact:true}).click();
  await page.evaluate(()=>audit.instrument.port.postMessage({t:'midi',st:0x90,d1:57,d2:100}));
  await page.waitForFunction(()=>audit.frame?.polyphony.slots.some(voice=>voice.gate)&&audit.waveHeight()>.03);
  const commands=await page.evaluate(()=>audit.commands.length);
  await spectrogram.focus();
  await spectrogram.press('Enter');
  await page.waitForFunction(()=>audit.spectralPeak(.98,1).intensity>75);
  assert.equal(await spectrogram.getAttribute('aria-pressed'),'true');
  assert.equal(await zoom.isVisible(),false);
  await oscilloscope.click();
  assert.equal(await oscilloscope.getAttribute('aria-pressed'),'true');
  assert(await page.evaluate(count=>audit.contexts===1&&audit.commands.length===count&&audit.frame.polyphony.slots.some(voice=>voice.gate),commands));
  await page.evaluate(()=>audit.instrument.port.postMessage({t:'midi',st:0x80,d1:57,d2:0}));
  await page.getByRole('button',{name:'Mute output',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ww-output-monitor .ww-meter output').textContent==='-120.0 dBFS');

  // A quiet Web Audio tone feeds only the analysis branch, with no speaker connection.
  const frequencies=await page.evaluate(()=>{
    const analyser=audit.analyser, context=analyser.context;
    const tone=context.createOscillator(),level=context.createGain();
    audit.tone=tone;
    const frequencies=[24,352].map(bin=>bin*context.sampleRate/analyser.fftSize);
    tone.frequency.value=frequencies[0];
    level.gain.value=.025;
    tone.connect(level).connect(analyser);
    tone.start();
    return frequencies;
  });
  const meters=()=>monitor.locator('.ww-meter output').allTextContents();
  await zoom.selectOption('1');
  await page.waitForFunction(()=>Math.abs(parseFloat(document.querySelector('.ww-output-monitor .ww-meter output').textContent)+35)<.2&&audit.waveHeight()>0);
  const rawMeters=await meters();
  const one=await page.evaluate(()=>audit.waveHeight());
  await zoom.selectOption('16');
  await page.waitForFunction(()=>audit.waveHeight()>.3);
  const expanded=await page.evaluate(()=>audit.waveHeight());
  assert(expanded>one*10);
  assert.deepEqual(await meters(),rawMeters);
  await zoom.selectOption('auto');
  await page.waitForFunction(()=>audit.waveHeight()>.65);
  const automatic=await page.evaluate(()=>audit.waveHeight());
  await monitor.screenshot({path:`${root}/oscilloscope.png`});

  const position=hz=>Math.log(16000/hz)/Math.log(16000/62.5);
  const expectBand=(left,right,hz)=>page.waitForFunction(([a,b,expected])=>{
    const band=audit.spectralPeak(a,b);
    return band.intensity>90&&Math.abs(band.position-expected)<.04;
  },[left,right,position(hz)]);
  await spectrogram.click();
  await expectBand(.9,.94,frequencies[0]);
  await page.evaluate(hz=>audit.tone.frequency.setValueAtTime(hz,audit.tone.context.currentTime),frequencies[1]);
  await expectBand(.98,1,frequencies[1]);
  await expectBand(.88,.92,frequencies[0]);
  await expectBand(.9,.92,frequencies[1]);
  await expectBand(.8,.82,frequencies[0]);
  await monitor.screenshot({path:`${root}/spectrogram.png`});
  await page.evaluate(()=>audit.tone.stop());

  const sizes=[];
  for(const [width,height] of [[3440,1440],[1100,900],[390,844]]){
    await page.setViewportSize({width,height});
    const chart=await canvas.boundingBox();
    assert(chart.width>150&&chart.height>=114);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    sizes.push({viewport:[width,height],chart:{width:chart.width,height:chart.height}});
  }
  await monitor.screenshot({path:`${root}/spectrogram-mobile.png`});
  assert.deepEqual(errors,[]);
  const report={result:'PASS',layout,one,expanded,automatic,rawMeters,frequencies,sizes,errors};
  fs.writeFileSync(`${root}/browser.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{
  await browser.close();
}
