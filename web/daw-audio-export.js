// SPDX-License-Identifier: GPL-3.0-only
import {PPQ,RATE,clipDuration,clipSeconds} from './daw-project.js';

const maxFrames=RATE*1200;
const tailOptions=[0,2,4,8];
const clean=name=>name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').trim().slice(0,80)||'Untitled';
const fileName=(name,extension)=>clean(name)+'.'+extension;
const clipStart=(clip,bpm)=>Math.round(clipSeconds(clip,bpm)*RATE);
const clipEnd=(clip,bpm)=>clip.type==='audio'?clipStart(clip,bpm)+clip.frames:
  Math.ceil((clipSeconds(clip,bpm)+clipDuration(clip,bpm))*RATE);

export function planAudioExport(project,{scope,format,trackId,clipIds,tail=0}){
  if(!['mix','range','selection','track','stems'].includes(scope)||!['wav','mp3'].includes(format)||
    scope==='stems'&&format!=='wav'||!tailOptions.includes(tail))throw Error('Invalid audio export options');
  let tracks=project.tracks,clips=project.clips,start=0;
  let end=Math.max(Math.ceil(project.length*60*RATE/(PPQ*project.bpm)),...clips.map(c=>clipEnd(c,project.bpm)));
  let name=project.name;
  if(scope==='track'){
    tracks=tracks.filter(t=>t.id===trackId);
    if(!tracks.length)throw Error('Select a track to export');
    clips=clips.filter(c=>c.trackId===trackId);
    name=tracks[0].name;
  }else if(scope==='range'){
    const range=project.transport||{start:0,end:project.length};
    const frame=tick=>Math.round(tick*60*RATE/(PPQ*project.bpm));
    start=frame(range.start);
    end=frame(range.end);
    name+=' - Range';
  }else if(scope==='selection'){
    const selection=clips.filter(c=>clipIds?.has(c.id));
    if(!selection.length)throw Error('Select clips to export');
    start=Math.min(...selection.map(c=>clipStart(c,project.bpm)));
    end=Math.max(...selection.map(c=>clipEnd(c,project.bpm)));
    clips=selection;
    name+=' - Selection';
  }
  if(!tracks.length)throw Error('Add a track before exporting');
  const isolated=scope==='track'||scope==='stems';
  const tailFrames=tail*RATE,frames=end-start+tailFrames;
  if(start>=end||end>maxFrames||frames>maxFrames)throw Error('Export supports up to 20 minutes, including its tail. Use a shorter range or tail.');
  clips=clips.filter(c=>clipStart(c,project.bpm)<end);
  const ids=new Set(tracks.map(t=>t.id));
  const outputs=isolated?tracks.map((t,i)=>({trackId:t.id,name:fileName(scope==='stems'?String(i+1).padStart(2,'0')+' - '+t.name:t.name,format)})):[{name:fileName(name,format)}];
  return {
    project:{...project,clips,tracks:isolated?tracks.map(t=>({...t,mute:false,solo:false})):tracks,
      automation:project.automation.filter(l=>ids.has(l.trackId)),master:isolated?{volume:1,fx:[]}:project.master},
    scope,format,outputs,start,end,tailFrames,frames,name
  };
}

async function encodeMp3(file,frames,signal,progress){
  signal.throwIfAborted();
  const worker=new Worker(new URL('./studio-mp3-worker.js',import.meta.url));
  try{
    return await new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
      const finish=(fn,value)=>{signal.removeEventListener('abort',abort);fn(value);};
      worker.onerror=()=>finish(reject,Error('MP3 encoding failed'));
      worker.onmessage=({data:m})=>{
        if(m.t==='progress')progress('Encoding MP3',m.frames/frames);
        else if(m.t==='finished')finish(resolve,m.audio);
        else if(m.t==='error')finish(reject,Error(m.message));
      };
      worker.postMessage({t:'encode',audio:file,frames});
    });
  }finally{worker.terminate();}
}

async function writeFile(handle,file,signal){
  signal.throwIfAborted();
  const writer=await handle.createWritable();
  try{await file.stream().pipeTo(writer,{signal});}
  catch(error){await writer.abort().catch(()=>{});throw error;}
}

export async function cleanAudioExports(root){
  for await(const [id,entry] of root){
    if(entry.kind!=='directory'||!(/^[0-9a-f-]{36}$/).test(id))continue;
    await navigator.locks.request('waswan-daw-export:'+id,{ifAvailable:true},async lock=>{
      if(lock)await root.removeEntry(id,{recursive:true}).catch(error=>{if(error.name!=='NotFoundError')throw error;});
    });
  }
}

export class DawAudioExport {
  constructor(workspace){this.w=workspace;this.job=null;}
  get busy(){return !!this.job;}
  cancel(error){this.job?.abort.abort(error);}
  checkIdle(){
    const w=this.w,p=w.player;
    if(!w.running)throw Error('Start audio before exporting');
    if(p.playing||p.starting||w.recorder.busy||w.audition.busy||w.importer.busy||w.bridge.isStudioBusy?.())
      throw Error('Stop playback, recording or audition before exporting');
    if(w.monitor.enabled||w.monitor.preparing||w.recorder.audioTrackId)
      throw Error('Turn off DAW MIDI and microphone inputs before exporting');
  }
  async choose(options,progress=()=>{}){
    if(this.job)throw Error('An export is already running');
    this.checkIdle();
    const controller=this.w.controller,revision=controller.revision;
    const plan=planAudioExport(controller.snapshot(),options),abort=new AbortController(),token=crypto.randomUUID();
    const job={abort,token,signal:abort.signal,fail:error=>abort.abort(error)};
    this.job=job;
    let root,dir,handle;
    try{
      handle=plan.scope==='stems'?await this.w.pick('showDirectoryPicker',{mode:'readwrite'}):await this.w.pick('showSaveFilePicker',{
        suggestedName:plan.outputs[0].name,
        types:[{description:plan.format==='wav'?'Stereo WAV':'MP3 192 kbps',accept:{[plan.format==='wav'?'audio/wav':'audio/mpeg']:['.'+plan.format]}}]
      });
      job.signal.throwIfAborted();
      if(this.w.controller!==controller||controller.revision!==revision)throw Error('Project changed before export');
      this.checkIdle();
      progress('Preparing audio',0);
      root=await(await navigator.storage.getDirectory()).getDirectoryHandle('waswan-daw-exports-v1',{create:true});
      await cleanAudioExports(root);
      job.signal.throwIfAborted();
      const {quota,usage}=await navigator.storage.estimate();
      if(Number.isFinite(quota)&&Number.isFinite(usage)&&quota-usage<(plan.frames*4+44)*plan.outputs.length)
        throw Error('Not enough browser storage to render these files');
      // The lease protects active temporary WAVs from cleanup in other views.
      return await navigator.locks.request('waswan-daw-export:'+token,async()=>{
        dir=await root.getDirectoryHandle(token,{create:true});
        try{
          const info=await this.capture(job,dir,plan,controller,revision,progress);
          job.signal.throwIfAborted();
          let result;
          if(plan.scope==='stems')result=await this.saveStems(job,dir,handle,plan,progress);
          else{
            const wav=await(await dir.getFileHandle('0.wav')).getFile();
            const file=plan.format==='mp3'?await encodeMp3(wav,plan.frames,job.signal,progress):wav;
            progress('Writing file',1);
            await writeFile(handle,file,job.signal);
            result=handle.name;
          }
          return {frames:info.frames,peaks:info.peaks,clipped:info.clipped,name:result,files:plan.outputs.length};
        }finally{await root.removeEntry(token,{recursive:true}).catch(()=>{});}
      });
    }finally{this.job=null;}
  }
  async capture(job,dir,plan,controller,revision,progress){
    const p=this.w.player,{signal,token}=job;
    const interrupt=()=>{p.generation++;p.stopSources();};
    signal.addEventListener('abort',interrupt,{once:true});
    let worker,node,sources=[],watchdog,readyTimer,context,abortCapture,workerClosed,workerDone=false;
    try{
      await p.beginExport(job);
      context=p.context;
      await context.audioWorklet.addModule(new URL('./daw-export-capture.js',import.meta.url));
      signal.throwIfAborted();
      const channel=new MessageChannel(),count=plan.outputs.length;
      node=new AudioWorkletNode(context,'waswan-daw-export-capture',{
        numberOfInputs:count+1,numberOfOutputs:1,outputChannelCount:[1],channelCount:2,channelCountMode:'explicit'
      });
      node.onprocessorerror=()=>job.fail(Error('Audio export processor stopped'));
      node.port.postMessage({t:'init',count,port:channel.port1},[channel.port1]);
      worker=new Worker(new URL('./daw-export-worker.js',import.meta.url),{type:'module'});
      let ready,finish;
      const initialized=new Promise(resolve=>{ready=resolve;});
      const captured=new Promise(resolve=>{finish=resolve;});
      workerClosed=new Promise(resolve=>{
        worker.onerror=()=>{resolve();job.fail(Error('Audio export writer failed'));};
        worker.onmessage=({data:m})=>{
          if(m.t==='ready')ready();
          else if(m.t==='finished'){workerDone=true;resolve();finish(m);}
          else if(m.t==='closed'){workerDone=true;resolve();}
          else if(m.t==='error'){workerDone=true;resolve();job.fail(Error(m.message));}
        };
      });
      worker.postMessage({dir,count,frames:plan.frames,port:channel.port2},[channel.port2]);
      const interrupted=new Promise((_,reject)=>{
        abortCapture=()=>reject(signal.reason);
        signal.addEventListener('abort',abortCapture,{once:true});
        if(signal.aborted)abortCapture();
      });
      interrupted.catch(()=>{});
      readyTimer=setTimeout(()=>job.fail(Error('Audio export writer did not start')),10000);
      await Promise.race([initialized,interrupted]);clearTimeout(readyTimer);
      // Arm capture before publishing the shared start frame to the audio host.
      const {startFrame}=await p.start({snapshot:()=>plan.project,assets:controller.assets,revision},{
        exportToken:token,signal,endFrame:plan.end,tailFrames:plan.tailFrames,click:{enabled:false,level:0},
        beforeStart:async({startFrame})=>{
          sources=plan.outputs.map(o=>o.trackId?p.tracks.get(o.trackId).meter:p.masterFx.output);
          sources.push(p.clockLink);
          sources.forEach((source,i)=>source.connect(node,0,i));
          node.connect(context.destination);
          const armed=new Promise(resolve=>{node.port.onmessage=({data:m})=>{if(m.t==='armed')resolve();};});
          node.port.postMessage({t:'arm',token,planId:p.planId,first:startFrame+plan.start,frames:plan.frames});
          readyTimer=setTimeout(()=>job.fail(Error('Audio export tap did not start')),5000);
          await Promise.race([armed,interrupted]);clearTimeout(readyTimer);
        }
      });
      let lastTime=context.currentTime,lastAdvance=performance.now();
      watchdog=setInterval(()=>{
        const time=context.currentTime,elapsed=Math.max(0,Math.floor(time*RATE)-startFrame),total=plan.end+plan.tailFrames;
        if(time>lastTime){lastTime=time;lastAdvance=performance.now();}
        if(context.state==='closed'||performance.now()-lastAdvance>6000||elapsed>total+RATE*6){
          job.fail(Error('Audio clock or export writer stopped'));
          return;
        }
        progress(elapsed<plan.start?'Rendering before selection':'Rendering audio',Math.min(1,elapsed/total));
      },250);
      return await Promise.race([captured,interrupted]);
    }finally{
      clearTimeout(readyTimer);clearInterval(watchdog);
      signal.removeEventListener('abort',interrupt);
      if(abortCapture)signal.removeEventListener('abort',abortCapture);
      if(node){
        for(const source of sources)try{source.disconnect(node);}catch{}
        node.disconnect();node.port.close();
      }
      try{await p.endExport(job);}
      finally{
        if(worker&&!workerDone){
          worker.postMessage({t:'cancel'});
          let timer;
          await Promise.race([workerClosed,new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);
          clearTimeout(timer);
        }
        worker?.terminate();
      }
    }
  }
  async saveStems(job,dir,destination,plan,progress){
    let name,folder;
    do{
      job.signal.throwIfAborted();
      name=clean(plan.name).slice(0,56)+' - Stems '+crypto.randomUUID();
      try{await destination.getDirectoryHandle(name);}
      catch(error){
        if(error.name==='NotFoundError')folder=await destination.getDirectoryHandle(name,{create:true});
        else if(error.name!=='TypeMismatchError')throw error;
      }
    }while(!folder);
    const created=[];
    try{
      for(const [i,output] of plan.outputs.entries()){
        job.signal.throwIfAborted();
        const file=await(await dir.getFileHandle(i+'.wav')).getFile();
        const handle=await folder.getFileHandle(output.name,{create:true});
        created.push(handle);
        progress('Writing stem '+(i+1)+' of '+plan.outputs.length,i/plan.outputs.length);
        await writeFile(handle,file,job.signal);
      }
      return name;
    }catch(error){
      for(const handle of created){
        try{
          const entry=await folder.getFileHandle(handle.name);
          if(await entry.isSameEntry(handle))await folder.removeEntry(handle.name);
        }catch{}
      }
      await destination.removeEntry(name).catch(()=>{});
      throw error;
    }
  }
}
