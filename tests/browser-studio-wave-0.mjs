// SPDX-License-Identifier: GPL-3.0-only
// Isolated feasibility probe; no recorder or scheduler is installed in the product.
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root='.local/validation/studio-wave-0';
fs.mkdirSync(root,{recursive:true});
const seconds=Number(process.env.STUDIO_PROBE_SECONDS||60);
assert(Number.isFinite(seconds)&&seconds>=30&&seconds<=1800);
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const report={status:'RUNNING',requestedSeconds:seconds,chrome:await browser.version(),physicalValidation:false};
try {
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.audit={contexts:0,commands:[],frames:0};
    const AC=AudioContext;
    window.AudioContext=class extends AC {
      constructor(options){super(options);audit.context=this;audit.contexts++;}
      createGain(){const g=super.createGain();audit.gain=g;return g;}
    };
    const AN=AudioWorkletNode;
    window.AudioWorkletNode=class extends AN {
      constructor(...args){
        super(...args);audit.node=this;
        const send=this.port.postMessage.bind(this.port);
        this.port.postMessage=(m,...rest)=>{audit.commands.push({...m,observedAt:performance.now()});send(m,...rest);};
        this.port.addEventListener('message',e=>{
          if(e.data.t==='frame'){audit.frame=e.data;audit.frames++;}
          if(e.data.t==='error')throw Error(e.data.message);
        });
      }
    };
    audit.source={id:'studio-probe',name:'Synthetic studio probe',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess=async()=>({inputs:new Map([[audit.source.id,audit.source]])});
  });
  await page.goto('http://localhost:8737/simulator/');
  await page.getByRole('button',{name:'Start audio',exact:true}).click();
  await page.waitForFunction(()=>audit.frame?.ms>5000);
  await page.getByRole('button',{name:'Connect MIDI keyboard',exact:true}).click();
  await page.waitForFunction(()=>!!audit.source.onmidimessage);
  await page.locator('.ww-midi-setup').locator('.ww-midi-continue').click();
  // POLY and a held chord produce real synth output through the original input path.
  await page.evaluate(()=>{
    audit.node.port.postMessage({t:'voice-mode',part:0,mode:0});
    for(const n of [48,52,55,59])audit.source.onmidimessage({data:[0x90,n,100],timeStamp:performance.now()});
  });
  await page.waitForFunction(()=>audit.frame.polyphony.slots.filter(v=>v.gate).length===4);

  const setup=await page.evaluate(async()=>{
    const ctx=audit.context;
    // Two taps: engine output (pre browser mute), and the existing monitor gain.
    // Eight transferable buffers are recycled directly between worklet and worker.
    const processor=`class CaptureProbe extends AudioWorkletProcessor {
      constructor(){super();this.pool=[];this.active=false;this.used=0;this.seq=0;this.dropped=0;
        this.port.onmessage=({data:m})=>{
          if(m.t==='buffer')this.pool.push(m.buffer);
          if(m.t==='start'){this.active=true;this.first=currentFrame;}
          if(m.t==='stop'){this.active=false;this.flush();this.port.postMessage({t:'end',first:this.first,end:currentFrame,dropped:this.dropped});}
        };
      }
      flush(){if(!this.used)return;this.port.postMessage({t:'chunk',buffer:this.buffer,frames:this.used,frame:this.chunkFrame,seq:this.seq++},[this.buffer]);this.buffer=null;this.used=0;}
      process(inputs,outputs){
        if(!this.active)return true;
        const n=outputs[0][0].length;
        if(!this.buffer){this.buffer=this.pool.pop();if(!this.buffer){this.dropped+=n;return true;}this.data=new Float32Array(this.buffer);this.chunkFrame=currentFrame;}
        for(let i=0;i<n;i++)for(let c=0;c<4;c++)this.data[(this.used+i)*4+c]=inputs[c<2?0:1]?.[c%2]?.[i]??0;
        this.used+=n;if(this.used===4096)this.flush();return true;
      }
    }registerProcessor('studio-capture-probe',CaptureProbe);`;
    const url=URL.createObjectURL(new Blob([processor],{type:'text/javascript'}));
    await ctx.audioWorklet.addModule(url);URL.revokeObjectURL(url);
    // The native constructor avoids replacing the audit's reference to the real synth.
    const NativeNode=Object.getPrototypeOf(AudioWorkletNode);
    audit.capture=new NativeNode(ctx,'studio-capture-probe',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
    audit.node.connect(audit.capture,0,0);audit.gain.connect(audit.capture,0,1);audit.capture.connect(ctx.destination);
    const workerCode=`let port,handle,dir,name,offset=0,seq=0,nextFrame=null,total=0,hash=0,pre=0,post=0,bad=0,gaps=0,lastPublish=0;
      onmessage=async({data:m})=>{try{
        if(m.stop){port.postMessage({t:'stop'});return;}
        port=m.port;dir=await navigator.storage.getDirectory();name='studio-wave-0-'+crypto.randomUUID()+'.raw';
        const file=await dir.getFileHandle(name,{create:true});handle=await file.createSyncAccessHandle();
        port.onmessage=({data:d})=>{try{
          if(d.t==='chunk'){
            if(d.seq!==seq++||(nextFrame!==null&&d.frame!==nextFrame))gaps++;
            nextFrame=d.frame+d.frames;const a=new Float32Array(d.buffer,0,d.frames*4),bytes=new Uint8Array(d.buffer,0,d.frames*16);
            if(handle.write(bytes,{at:offset})!==bytes.byteLength)throw Error('Short file write');offset+=bytes.byteLength;
            const words=new Uint32Array(d.buffer,0,d.frames*4);
            for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i]))bad++;hash=Math.imul(hash^words[i],16777619)>>>0;if(i%4<2)pre=Math.max(pre,Math.abs(a[i]));else post=Math.max(post,Math.abs(a[i]));}
            total+=d.frames;port.postMessage({t:'buffer',buffer:d.buffer},[d.buffer]);
            if(total-lastPublish>=44100){postMessage({t:'progress',frames:total,prePeak:pre,postPeak:post});pre=post=0;lastPublish=total;}
          }
          if(d.t==='end'){
            handle.flush();const size=handle.getSize();let readHash=0;const buffer=new ArrayBuffer(65536);
            for(let at=0;at<size;){const count=handle.read(new Uint8Array(buffer),{at});if(!count)throw Error('Short file read');for(const w of new Uint32Array(buffer,0,count/4))readHash=Math.imul(readHash^w,16777619)>>>0;at+=count;}
            handle.close();handle=null;
            postMessage({...d,t:'done',name,frames:total,bytes:offset,fileBytes:size,hash,readHash,bad,gaps,chunks:seq});
          }
        }catch(e){postMessage({t:'error',message:e.message});}};
        for(let i=0;i<8;i++){const buffer=new ArrayBuffer(4096*16);port.postMessage({t:'buffer',buffer},[buffer]);}
        port.postMessage({t:'start'});postMessage({t:'ready'});
      }catch(e){postMessage({t:'error',message:e.message});}};`;
    const workerUrl=URL.createObjectURL(new Blob([workerCode],{type:'text/javascript'}));
    audit.worker=new Worker(workerUrl);URL.revokeObjectURL(workerUrl);
    audit.progress=[];audit.worker.onmessage=({data:m})=>{
      if(m.t==='progress')audit.progress.push(m);
      if(m.t==='ready')audit.captureReady=true;
      if(m.t==='done')audit.captureResult=m;
      if(m.t==='error')audit.workerError=m.message;
    };
    audit.worker.postMessage({port:audit.capture.port},[audit.capture.port]);
    return {sampleRate:ctx.sampleRate,baseLatency:ctx.baseLatency,outputLatency:ctx.outputLatency,
      crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer,opfs:!!navigator.storage?.getDirectory,
      codecs:Object.fromEntries(['audio/wav','audio/mpeg','audio/webm;codecs=opus'].map(t=>[t,MediaRecorder.isTypeSupported(t)]))};
  });
  report.environment=setup;
  await page.waitForFunction(()=>audit.captureReady||audit.workerError);
  assert.equal(await page.evaluate(()=>audit.workerError),undefined);
  const started=Date.now(),cdp=await context.newCDPSession(page),memory=[];
  const sampleMemory=async()=>{await cdp.send('HeapProfiler.collectGarbage');memory.push({wallMs:Date.now()-started,...await cdp.send('Runtime.getHeapUsage')});};
  await sampleMemory();
  await page.waitForFunction(()=>audit.progress.length>=3);
  await page.getByRole('button',{name:'Mute output',exact:true}).click();
  const mark=await page.evaluate(()=>audit.progress.length);
  await page.waitForFunction(n=>audit.progress.length>=n+3,mark);
  const muted=await page.evaluate(()=>audit.progress.at(-1));
  assert(muted.prePeak>0&&muted.postPeak<1e-5,'engine capture remains audible while browser monitoring is muted');
  await page.getByRole('button',{name:'Muted · unmute',exact:true}).click();
  // Deliberately block UI for 1.2 seconds: worker must keep receiving PCM independently.
  await page.evaluate(()=>{const end=performance.now()+1200;while(performance.now()<end){Math.sqrt(Math.random());}});
  await page.evaluate(async()=>{await audit.context.suspend();});
  await page.waitForTimeout(250);
  await page.evaluate(async()=>{await audit.context.resume();});
  await sampleMemory();
  while(Date.now()-started<seconds*1000){
    await page.waitForTimeout(Math.min(10000,seconds*1000-(Date.now()-started)));
    assert.equal(await page.evaluate(()=>audit.workerError),undefined);
    await sampleMemory();
    console.log(JSON.stringify({status:'capturing',wallSeconds:Math.round((Date.now()-started)/1000),frames:await page.evaluate(()=>audit.progress.at(-1)?.frames)}));
  }
  // Main thread has relinquished the capture port: stop is forwarded by its worker.
  await page.evaluate(()=>audit.worker.postMessage({stop:true}));
  await page.waitForFunction(()=>audit.captureResult||audit.workerError,null,{timeout:15000});
  assert.equal(await page.evaluate(()=>audit.workerError),undefined);
  const result=await page.evaluate(()=>audit.captureResult);
  assert.equal(result.dropped,0);assert.equal(result.gaps,0);assert.equal(result.bad,0);
  assert.equal(result.frames,result.end-result.first);assert.equal(result.bytes,result.frames*16);
  assert.equal(result.fileBytes,result.bytes);assert.equal(result.hash,result.readHash);
  assert(result.frames/setup.sampleRate>seconds-5,'capture progressed at real-time rate');
  assert(memory.at(-1).usedSize-memory[0].usedSize<8*1024*1024,'main retained JS heap grew excessively');
  assert.equal(await page.evaluate(()=>audit.contexts),1);assert.deepEqual(errors,[]);
  // Reload without restarting the instrument, verify the file, then remove this probe's artifact.
  await page.reload();
  const recovered=await page.evaluate(async name=>{
    const dir=await navigator.storage.getDirectory(),file=await(await dir.getFileHandle(name)).getFile();
    const size=file.size;let hash=0;
    for(let at=0;at<size;at+=65536){const data=await file.slice(at,at+65536).arrayBuffer();for(const word of new Uint32Array(data))hash=Math.imul(hash^word,16777619)>>>0;}
    await dir.removeEntry(name);return {size,hash};
  },result.name);
  assert.equal(recovered.size,result.bytes);assert.equal(recovered.hash,result.hash);
  Object.assign(report,{status:'PASS',wallMs:Date.now()-started,capture:result,muted,mainThreadBlockMs:1200,suspendMs:250,memory,errors,
    recovered,scope:'Real synth PCM to OPFS via direct worklet-worker port; no MIDI/audio alignment or hardware dropout measurement'});
  fs.writeFileSync(`${root}/capture.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}catch(error){report.status='FAIL';report.error=String(error.stack||error);fs.writeFileSync(`${root}/capture.json`,JSON.stringify(report,null,2));throw error;}
finally{await browser.close();}
