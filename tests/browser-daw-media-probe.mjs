// SPDX-License-Identifier: GPL-3.0-only
// Feasibility probe, not the production importer or a duration certification.
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='.local/validation/daw-mvp-wave-1';fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8737/simulator/');
 const report=await page.evaluate(async()=>{
  const rate=44100,seconds=300,frames=rate*seconds,errors=[];
  const context=new AudioContext({sampleRate:rate});await context.resume();
  try{
   const started=performance.now();
   const [wasm,store]=await Promise.all(['obervave-voice.wasm','factory-session.bin'].map(async p=>(await fetch(p)).arrayBuffer()));
   await context.audioWorklet.addModule('worklet.js');
   const synth=new AudioWorkletNode(context,'obervave-smk37',{numberOfInputs:0,numberOfOutputs:5,outputChannelCount:[2,2,2,2,2],processorOptions:{wasm,store,dawOutputs:true}});
   let state,ready=false;synth.port.onmessage=({data:m})=>{if(m.t==='ready')ready=true;if(m.t==='frame')state=m;if(m.t==='error')errors.push(m.message);};
   // Only dry parts 0–2 feed the proof mixer; final Legacy stereo stays disconnected.
   const master=context.createGain();master.gain.value=.1;master.connect(context.destination);
   const analyses=[];
   for(let p=0;p<3;p++){
    const gain=context.createGain(),filter=context.createBiquadFilter();gain.gain.value=.5;filter.type='lowpass';filter.frequency.value=1000+p*1000;
    synth.connect(filter,p+1);filter.connect(gain);gain.connect(master);
    const analyser=context.createAnalyser();gain.connect(analyser);analyses.push(analyser);
   }
   await new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(ready&&state?.ms>5000){clearInterval(timer);resolve();}},25);setTimeout(()=>{clearInterval(timer);reject(Error('Instrument boot timeout'));},15000);});
   const buffers=[];
   for(let p=0;p<5;p++){
    const b=context.createBuffer(2,frames,rate);
    for(let c=0;c<2;c++){const data=b.getChannelData(c);for(let i=0;i<frames;i++)data[i]=Math.sin(2*Math.PI*(110+p*55)*i/rate)*.01;}
    buffers.push(b);
   }
   // Store/read a full 5-minute PCM16 source, without making a huge JSON/base64 string.
   const {wavHeader}=await import('/simulator/studio-format.js'),folder=await navigator.storage.getDirectory();
   const filename='waswan-daw-feasibility-'+crypto.randomUUID()+'.wav';
   let persisted;
   try{
    const handle=await folder.getFileHandle(filename,{create:true}),writer=await handle.createWritable();
    await writer.write(wavHeader(frames));const block=new Int16Array(rate*2);
    for(let i=0;i<block.length;i++)block[i]=Math.round(Math.sin(2*Math.PI*220*Math.floor(i/2)/rate)*2048);
    for(let i=0;i<seconds;i++)await writer.write(block);await writer.close();
    const file=await handle.getFile(),decoded=await context.decodeAudioData(await file.arrayBuffer());
    if(decoded.length!==frames||decoded.numberOfChannels!==2)throw Error('Long source roundtrip changed duration');
    const first=decoded.getChannelData(0)[20],last=decoded.getChannelData(0)[frames-rate+20];if(first!==last||!Number.isFinite(first))throw Error('Source roundtrip mismatch');
    persisted={bytes:file.size,decodedFrames:decoded.length,headTailMatch:true};
   }finally{await folder.removeEntry(filename);}
   const preparationMs=performance.now()-started;
   // Native decoder accepts MP3 and resamples ordinary WAV to the context rate.
   const shortPcm=new Int16Array(rate*2);for(let i=0;i<rate;i++)shortPcm[i*2]=shortPcm[i*2+1]=Math.round(Math.sin(2*Math.PI*220*i/rate)*2048);
   const shortWav=new Blob([wavHeader(rate),shortPcm]);
   const encoded=await new Promise((resolve,reject)=>{
    const worker=new Worker('/simulator/studio-mp3-worker.js'),timer=setTimeout(()=>{worker.terminate();reject(Error('MP3 probe timeout'));},15000);
    worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('MP3 probe failed'));};
    worker.onmessage=({data:m})=>{if(m.t==='finished'||m.t==='error'){clearTimeout(timer);worker.terminate();m.t==='finished'?resolve(m.audio):reject(Error(m.message));}};
    worker.postMessage({t:'encode',audio:shortWav,frames:rate});
   });
   const mp3=await context.decodeAudioData(await encoded.arrayBuffer());
   const header48=wavHeader(48000),view48=new DataView(header48);view48.setUint32(24,48000,true);view48.setUint32(28,48000*4,true);
   const wav48=await context.decodeAudioData(await new Blob([header48,new Int16Array(48000*2)]).arrayBuffer());
   const decodedFormats={mp3:{sampleRate:mp3.sampleRate,frames:mp3.length,bytes:encoded.size},wav48:{sampleRate:wav48.sampleRate,frames:wav48.length}};
   // Decoder output frames are authoritative. Chrome may round resampling by a
   // frame; an untagged LAME stream includes encoder delay and MPEG padding.
   if(mp3.sampleRate!==rate||mp3.length<rate||mp3.length>rate+2304||wav48.sampleRate!==rate||Math.abs(wav48.length-rate)>1||!mp3.getChannelData(0).some(v=>Math.abs(v)>.001))throw Error('Native import decoder/resampling failed: '+JSON.stringify(decodedFormats));
   for(let p=0;p<3;p++){synth.port.postMessage({t:'voice-mode',part:p,mode:0});}
   synth.port.postMessage({t:'studio-sequence-start',data:{length:rate*10,loop:false,bpm:120,ticks:19200,events:[0,1,2].flatMap(part=>[{frame:0,part,note:60+part*4,velocity:90},{frame:rate*9,part,note:60+part*4,velocity:0}]).sort((a,b)=>a.frame-b.frame)}});
   const sources=buffers.map((buffer,p)=>{const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;gain.gain.value=.2;source.connect(gain).connect(master);source.start(context.currentTime+.1,p%2?290:0,8);return source;});
   const energies=[0,0,0],start=context.currentTime;
   while(context.currentTime-start<8.5){
    analyses.forEach((a,p)=>{const samples=new Float32Array(a.fftSize);a.getFloatTimeDomainData(samples);for(const v of samples){if(!Number.isFinite(v))throw Error('Nonfinite dry output');energies[p]+=Math.abs(v);}});
    await new Promise(resolve=>setTimeout(resolve,50));
   }
   sources.forEach(s=>s.stop());
   return {secondsPerSource:seconds,audioSources:5,instrumentParts:3,floatPcmBytes:5*2*frames*4,persisted,preparationMs,nativeMp3Decode:true,nativeWav48kResampling:true,decodedFormats,observedPlaybackSeconds:context.currentTime-start,dryEnergy:energies,errors,contextState:context.state,wholeSongWallClockTest:false,physicalValidation:false,limitations:['whole AudioBuffers with bounded but substantial native memory','one persisted source roundtrip; no crash/quota test','no measured device underruns or total native memory']};
  }finally{await context.close();}
 });
 assert.deepEqual(report.errors,[]);assert(report.dryEnergy.every(e=>e>0));assert.equal(report.contextState,'running');
 fs.writeFileSync(`${root}/media-probe.json`,JSON.stringify({result:'PASS',chrome:await browser.version(),...report},null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
