// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/daw-mvp-wave-9';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  await page.goto('http://localhost:8737/simulator/?workspace=daw');
  await page.evaluate(async()=>{
    const {DawMix}=await import('/simulator/ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){globalThis.workspace=this.w;return refresh.apply(this,args);};
  });
  await page.locator('.ww-daw').getByRole('button',{name:'Add audio track',exact:true}).click();

  const retention=await page.evaluate(async()=>{
    const w=workspace,{wavHeader}=await import('/simulator/studio-format.js');
    const source=new File([wavHeader(4410),new Int16Array(8820).fill(4096)],'source.wav',{type:'audio/wav'});
    const {sourceChecksum}=await import('/simulator/daw-format.js');
    const checksum=await sourceChecksum(source);
    const dir=await navigator.storage.getDirectory();
    const imports=await dir.getDirectoryHandle('waswan-daw-imports-v1',{create:true});
    const dirs=async handle=>{const names=[];for await(const name of handle.keys())names.push(name);return names;};
    async function importClip(){return w.importer.import(source,{trackId:w.selected,atBeat:0});}
    async function removeClip(clip){
      w.controller.command('batch',{commands:[
        {type:'clip.remove',payload:{id:clip.id}},
        {type:'asset.remove',payload:{id:clip.assetId}}
      ]});
      await w.assetRetention.collect();
    }
    const first=await importClip();
    await w.auto.close();
    const [initial]=await dirs(imports);
    if(!initial)throw Error('Import has no immutable storage');
    w.clipTools.copy();
    await removeClip(first);
    const undoKeeps=(await dirs(imports)).includes(initial);
    w.controller.command('undo');
    const undoBytes=await sourceChecksum(w.controller.assets.get(first.assetId))===checksum;
    w.controller.command('redo');
    w.controller.clearHistory();
    await w.assetRetention.collect();
    const clipboardKeeps=(await dirs(imports)).includes(initial);
    w.clipTools.paste();
    const pasted=w.snapshot.clips[0];
    const pasteBytes=await sourceChecksum(w.controller.assets.get(pasted.assetId))===checksum;
    w.clipTools.clipboard=null;
    await removeClip(pasted);
    w.controller.clearHistory();
    await w.assetRetention.collect();
    const collected=!(await dirs(imports)).includes(initial);

    const second=await importClip(),id=w.snapshot.id;
    const recovery=(await dir.getDirectoryHandle('waswan-daw-recovery-v3',{create:true}));
    await w.files.saveRecovery(w.controller);
    const generations=await recovery.getDirectoryHandle(id),audio=await generations.getDirectoryHandle('audio');
    const [entry]=await dirs(audio);
    await removeClip(second);
    await w.files.saveRecovery(w.controller);
    const intactPrevious=(await dirs(audio)).includes(entry);
    const index=await generations.getFileHandle('index.json'),names=JSON.parse(await(await index.getFile()).text()).generations;
    const head=await generations.getFileHandle(names[0]),writer=await head.createWritable();
    await writer.write('interrupted manifest');await writer.close();
    const parts=w.files.recoveryParts;
    w.files.recoveryParts=async function(folder,name){
      if(name===names[1])throw new DOMException('Temporarily unreadable','NotReadableError');
      return parts.call(this,folder,name);
    };
    const transient=await w.files.saveRecovery(w.controller);
    w.files.recoveryParts=parts;
    const transientKept=transient.cleanupPending&&(await dirs(audio)).includes(entry)&&(await dirs(generations)).includes(names[1]);
    // Tear the newer committed manifest too, so the intact audio generation is recovered.
    const newest=JSON.parse(await(await index.getFile()).text()).generations[0];
    const newestFile=await generations.getFileHandle(newest),newWriter=await newestFile.createWritable();
    await newWriter.write('interrupted replacement');await newWriter.close();
    const recovered=await w.files.recover(id,{deferBinding:true});
    const fallbackBytes=await sourceChecksum(recovered.assets.get(second.assetId))===checksum;
    await recovered.dispose();
    await w.files.saveRecovery(w.controller); // Still keep the last valid generation.
    const survivedTorn=(await dirs(audio)).includes(entry);
    await w.files.saveRecovery(w.controller); // Two valid generations now omit the source.
    const swept=!(await dirs(audio)).includes(entry);
    return {undoKeeps,undoBytes,clipboardKeeps,pasteBytes,collected,intactPrevious,transientKept,fallbackBytes,survivedTorn,swept};
  });
  for(const [key,value] of Object.entries(retention))assert(value,key);

  const lifecycle=await page.evaluate(async()=>{
    const [{DawPlayer},{ProjectController},{emptyProject,makeTrack,uuid},{wavHeader},{effect}]=await Promise.all(
      ['daw-player','daw-controller','daw-project','studio-format','daw-fx-catalog'].map(n=>import('/simulator/'+n+'.js')));
    const [wasm,seed]=await Promise.all(['obervave-voice.wasm','factory-session.bin'].map(async name=>(await fetch(name)).arrayBuffer()));
    let audio,player,simultaneous=0,lastTransport;
    async function boot(){
      if(audio&&audio.context.state!=='closed')throw Error('Previous context is still live');
      const context=new AudioContext({sampleRate:44100});
      await context.resume();
      await context.audioWorklet.addModule('/simulator/worklet.js');
      const node=new AudioWorkletNode(context,'obervave-smk37',{
        numberOfOutputs:17,outputChannelCount:Array(17).fill(2),processorOptions:{wasm,store:seed}
      });
      const gain=context.createGain();
      node.connect(gain).connect(context.destination);
      audio={context,node,gain};
      simultaneous=Math.max(simultaneous,1);
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Host boot deadline')),12000);
        node.port.onmessage=({data:m})=>{
          if(m.t==='error'){clearTimeout(timer);reject(Error(m.message));}
          if(m.t==='frame'&&m.ms>5000){clearTimeout(timer);resolve();}
          player?.receive(m);
        };
      });
    }
    const p=emptyProject(),track=makeTrack('audio','Graph fixture'),asset=uuid(),frames=44100;
    p.length=1920;track.fx=[effect('delay')];p.master.fx=[effect('limiter')];p.tracks.push(track);
    const samples=new Int16Array(frames*2).fill(2048),blob=new Blob([wavHeader(frames),samples],{type:'audio/wav'});
    p.assets.push({id:asset,name:'Graph source',sampleRate:44100,channels:2,frames,bytes:blob.size});
    p.clips.push({id:uuid(),trackId:track.id,assetId:asset,type:'audio',name:'Graph clip',
      position:{unit:'seconds',value:0},offset:0,frames,gain:1,fadeIn:0,fadeOut:0});
    const controller=new ProjectController(p,new Map([[asset,blob]]));
    player=new DawPlayer({getAudio:()=>audio},state=>{lastTransport=state;});
    await boot();
    await player.start(controller);
    const context1=audio.context,firstTrack=player.tracks.get(track.id),firstRpc=player.rpc;
    const first=await player.mediaRpc.request('info');
    await player.stop(true);await context1.close();
    await boot();
    await player.start(controller);
    await new Promise(resolve=>setTimeout(resolve,420));
    const second=await player.mediaRpc.request('info'),peak=Math.max(...player.masterLevels.peaks);
    const restarted=player.tracks.get(track.id)!==firstTrack&&player.context===audio.context&&firstRpc.closed&&firstTrack.rpc.closed;
    const stopped=await new Promise(resolve=>{
      const start=performance.now(),timer=setInterval(()=>{
        if(!player.playing||performance.now()-start>3000){clearInterval(timer);resolve(lastTransport?.reason==='ended');}
      },10);
    });
    if(stopped)await player.start(controller);
    await player.stop(true);await audio.context.close();
    return {restarted,stopped,firstFrames:first.frames,secondFrames:second.frames,peak,simultaneous};
  });
  assert(lifecycle.restarted&&lifecycle.stopped&&lifecycle.peak>.01);
  assert.equal(lifecycle.firstFrames,44100);
  assert.equal(lifecycle.secondFrames,44100);
  assert.equal(lifecycle.simultaneous,1);
  assert.deepEqual(errors,[]);
  const result={result:'PASS',retention,lifecycle,physicalValidation:false};
  fs.writeFileSync(`${root}/storage-context.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await browser.close();}
