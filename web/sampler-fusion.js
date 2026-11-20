// SPDX-License-Identifier: GPL-3.0-only
import {emptyProject, makeTrack, PPQ, RATE, uuid, validateProject} from './daw-project.js';
import {validateEffects} from './daw-fx-catalog.js';
import {assignSlots} from './daw-playback.js';
import {planAudioExport} from './daw-audio-export.js';
import {prepareProjectSamplers} from './sampler.js';
import {importOriginal, readLibrary} from './sampler-library.js';
import {createWorking} from './sampler-working.js';
import {createInstrument, samplerLimits,compile} from './sampler-instrument.js';
import {mapCaptureTakes,planCapture} from './sampler-capture.js';
import {applyFusionPhrase} from './sampler-fusion-phrase.js';

const midi = (value,lo=0) => Number.isInteger(value) && value >= lo && value <= 127;
const within = (value,[lo,hi]) => value >= lo && value <= hi;
const range = (pair,lo) => Array.isArray(pair) && pair.length === 2 && pair.every(n=>midi(n,lo)) && pair[0]<=pair[1];

function normalizeSources(entries) {
  if (!Array.isArray(entries) || !entries.length) throw Error('Choose a Fusion instrument.');
  const ids = new Set();
  return entries.map(entry=>{
    const source = structuredClone({volume:1,pan:0,transpose:0,key:[0,127],velocity:[1,127],fx:[],...entry});
    if (typeof source.id !== 'string' || !source.id || ids.has(source.id)) throw Error('Choose a distinct identity for each source.');
    ids.add(source.id);
    if (!source.instrument || !range(source.key,0) || !range(source.velocity,1) ||
        !Number.isInteger(source.transpose) || Math.abs(source.transpose) > 127) throw Error('Check the source instrument, key range, velocity range and transposition.');
    return source;
  });
}

function sourceProject(sources, masterFx) {
  const project = emptyProject();
  project.name = 'Sound Fusion';
  project.master.fx = structuredClone(masterFx);
  project.tracks = sources.map((s,i)=>({...makeTrack('midi',String(s.name||'Instrument').slice(0,80)),id:project.id+'-'+i,instrument:s.instrument,
    volume:s.volume,pan:s.pan,fx:s.fx}));
  validateProject(project);
  validateEffects(project);
  assignSlots(project);
  return project;
}

function destinations(sources,note,velocity) {
  return sources.flatMap((source,index)=>{
    const pitch = note + source.transpose;
    return within(note,source.key) && within(velocity,source.velocity) && midi(pitch) ? [{index,pitch}] : [];
  });
}

function takeProject(template,sources,take,{duration,sustain,release}) {
  const project = structuredClone(template);
  const tick = seconds => Math.round(seconds*PPQ*project.bpm/60);
  const releaseTick = Math.max(1,tick(duration+sustain));
  project.length = Math.max(releaseTick+Number(sustain>0),tick(duration+sustain+release));
  project.transport.end = project.length;
  const selected = destinations(sources,take.note,take.velocity);
  if (!selected.length) throw Error('No Fusion source covers MIDI '+take.note+' at velocity '+take.velocity+'.');
  for (const {index,pitch} of selected) {
    const track = project.tracks[index];
    const pedal = sustain > 0 && track.instrument.type === 'sampler';
    const note = {id:uuid(),pitch,velocity:take.velocity,start:0,duration:pedal?Math.max(1,tick(duration)):releaseTick};
    const clip = {id:uuid(),type:'midi',trackId:track.id,name:track.name,position:{unit:'ticks',value:0},
      length:project.length,loopLength:project.length,loop:false,notes:[note]};
    if (pedal) clip.midiEvents = [0,releaseTick].map((tick,i)=>({id:uuid(),type:'cc',channel:0,controller:64,tick,value:i?0:127}));
    project.clips.push(clip);
  }
  return validateProject(project);
}

function reserve(workspace,signal,fusionMonitor=false) {
  signal?.throwIfAborted();
  const exporter = workspace.audioExport.exporter;
  if (workspace.busy || exporter.busy) throw Error('Finish the current DAW operation before starting Sound Fusion.');
  exporter.checkIdle();
  const abort = new AbortController();
  const job = {token:uuid(),abort,signal:signal?AbortSignal.any([signal,abort.signal]):abort.signal,
    fail:error=>abort.abort(error),fusionMonitor,restoreGraph:true};
  exporter.job = job;
  workspace.busy = true;
  workspace.refreshControls();
  return job;
}

function unlock(workspace,job) {
  const exporter = workspace.audioExport.exporter;
  if (exporter.job !== job) return;
  exporter.job = null;
  workspace.busy = false;
  workspace.refreshControls();
}

export async function captureFusion(workspace,root,entries,options={}) {
  const {mode='single',name='Fusion',notes=[60],velocities=[100],repeats=1,duration=.6,release=.3,sustain=0,tail=0,
    masterFx=[],phrase,signal,onProgress=()=>{}} = options;
  if (!['single','texture','multi'].includes(mode) ||
      (mode!=='multi' && (notes.length!==1 || velocities.length!==1 || repeats!==1))) {
    throw Error('Use Multisample to capture several notes, velocities or repeats.');
  }
  if (phrase && mode!=='texture') throw Error('Choose Texture to render a MIDI phrase.');
  if (typeof name!=='string' || !name.trim() || name.length>120 || !Number.isFinite(sustain) || sustain<0 ||
      !Number.isFinite(release) || release<0 || !Number.isFinite(duration) || duration<=0) throw Error('Check the Fusion name and note or release lengths.');
  const sources=normalizeSources(entries),template=sourceProject(sources,masterFx);
  const plan=planCapture({notes,velocities,repeats,duration,release:sustain+release+tail,
    destination:'Samples/Originals/Fusion/'+uuid()});
  if (repeats>samplerLimits.variationMembers || (repeats>1 && notes.length*velocities.length>samplerLimits.variations)) {
    throw Error('This multisample exceeds the sampler round-robin set or take limit.');
  }
  const jobs=plan.takes.map(take=>{
    const project=phrase ? applyFusionPhrase(structuredClone(template),sources,phrase,{duration,release,sustain})
      : takeProject(template,sources,take,{duration,release,sustain});
    const audioPlan=planAudioExport(project,{scope:'mix',format:'wav',tail});
    if (mode==='multi' && audioPlan.frames*4>samplerLimits.memoryBytes) throw Error('This stereo take exceeds the sampler PCM memory budget.');
    return {take,project,audioPlan};
  });
  const library=await readLibrary(root);
  const job=reserve(workspace,signal),takes=[];
  const report={frames:0,peak:0,clipped:0,completed:0,total:jobs.length};
  const progress=(stage,fraction)=>onProgress({stage,progress:(report.completed+fraction)/report.total,
    completed:report.completed,total:report.total});
  try {
    const storage=await navigator.storage.getDirectory();
    const scratch=await storage.getDirectoryHandle('waswan-daw-exports-v1',{create:true});
    const {quota,usage}=await navigator.storage.estimate();
    const largest=Math.max(...jobs.map(({audioPlan})=>44+audioPlan.frames*4));
    if (Number.isFinite(quota)&&Number.isFinite(usage)&&quota-usage<largest) throw Error('Not enough temporary storage for one Fusion take.');
    await navigator.locks.request('waswan-daw-export:'+job.token,async()=>{
      const batch=await scratch.getDirectoryHandle(job.token,{create:true});
      try {
        for (const {take,project,audioPlan} of jobs) {
          job.signal.throwIfAborted();
          const dir=await batch.getDirectoryHandle(take.id,{create:true});
          const info=await workspace.audioExport.exporter.capture({...job,token:uuid()},dir,audioPlan,
            {snapshot:()=>project,assets:new Map(),revision:0},0,progress);
          job.signal.throwIfAborted();
          const peak=info.peaks[0],clipped=info.clipped[0];
          if (peak<1/32768) throw Error('The Fusion take '+take.id+' is silent. Check its source zones and levels.');
          if (clipped) throw Error('The Fusion take '+take.id+' clipped '+clipped+' samples. Lower its source levels.');
          const file=await (await dir.getFileHandle('0.wav')).getFile();
          const fusion={version:1,mode,name,sources,masterFx:structuredClone(masterFx),...(phrase?{phrase}:{}),
            notes:[...notes],velocities:[...velocities],repeats,note:take.note,velocity:take.velocity,repeat:take.repeat,duration,sustain,release,tail};
          const sample=await importOriginal(root,file,take.path,{name:mode==='multi'?name+' '+take.id:name,provenance:{fusion}});
          takes.push({...take,sample,peak,clipped,frames:info.frames});
          report.frames+=info.frames;
          report.peak=Math.max(report.peak,peak);
          report.completed=takes.length;
          await batch.removeEntry(take.id,{recursive:true});
          progress('Captured '+take.id,0);
        }
      }finally{await scratch.removeEntry(job.token,{recursive:true});}
    });
    job.signal.throwIfAborted();
    let instrument=null;
    if (mode==='multi') {
      const {samples,regions,variations}=mapCaptureTakes(plan,new Map(takes.map(t=>[t.id,t.sample])));
      instrument=createInstrument({name,samples,regions,variations});
      compile(instrument);
    }
    const first=takes[0];
    const draft=createWorking({libraryId:library.id,source:first.sample,name,rootNote:first.note,instrument});
    return {draft,takes,report};
  }catch(cause){
    const error=cause instanceof Error?cause:new Error(String(cause));
    error.completedTakes=takes;
    throw error;
  }finally{unlock(workspace,job);}
}

// MIDI owners retain their accepted destinations through edits to the source zones.
// A virtual key and a hardware channel can hold the same pitch independently.
class FusionMonitor {
  constructor(workspace,job,sources,project,slots,onError) {
    Object.assign(this,{workspace,job,sources,project,slots,onError});
    this.owners=new Map();
    this.queue=Promise.resolve();
    this.closed=new Promise(resolve=>{this.didClose=resolve;});
    this.abort=()=>{void this.close().catch(error=>this.onError?.(error));};
    job.signal.addEventListener('abort',this.abort,{once:true});
  }
  rpc(type,payload={}) {
    return this.workspace.player.requests().request(type,{...payload,projectId:this.project.id,
      token:this.job.token,exportToken:this.job.token});
  }
  run(fn) {
    if (this.closing) return Promise.resolve();
    const operation=this.queue.then(()=>{
      this.job.signal.throwIfAborted();
      return fn();
    });
    this.queue=operation.catch(error=>{this.job.fail(error);this.onError?.(error);});
    return operation;
  }
  owner(label,channel,create) {
    if (typeof label!=='string' || !label || !Number.isInteger(channel) || channel<0 || channel>15) throw Error('Invalid Fusion input identity.');
    const key=JSON.stringify([label,channel]);
    let entry=this.owners.get(key);
    if (entry || !create) return entry;
    const occupied=new Set([...this.owners.values()].map(o=>o.channel));
    const available=[channel,...Array.from({length:16},(_,i)=>i)].find(i=>!occupied.has(i));
    if (available===undefined) throw Error('All sixteen Fusion input channels are in use.');
    entry={key,label,originalChannel:channel,channel:available,notes:new Map(),parts:new Set(),pedal:false};
    this.owners.set(key,entry);
    return entry;
  }
  sendNote(entry,target,velocity) {
    return this.rpc('daw-live-note',{part:target.part,channel:entry.channel,note:target.pitch,velocity});
  }
  async noteOff(entry,note) {
    const targets=entry.notes.get(note)??[];
    entry.notes.delete(note);
    for (const target of targets) {
      const covered=[...entry.notes.values()].some(other=>other.some(t=>t.part===target.part&&t.pitch===target.pitch));
      if (!covered) await this.sendNote(entry,target,0);
    }
  }
  note({owner,channel=0,note,velocity}) {
    return this.run(async()=>{
      if (!midi(note) || !midi(velocity)) throw Error('Invalid Fusion note or velocity.');
      const entry=this.owner(owner,channel,velocity>0);
      if (!entry) return;
      await this.noteOff(entry,note);
      if (!velocity) return;
      const accepted=[];
      entry.notes.set(note,accepted);
      for (const {index,pitch} of destinations(this.sources,note,velocity)) {
        const part=this.slots.get(this.project.tracks[index].id);
        if (!entry.parts.has(part) && entry.pedal) await this.rpc('daw-live-pedal',{channel:entry.channel,part,down:1});
        entry.parts.add(part);
        await this.sendNote(entry,{part,pitch},velocity);
        accepted.push({part,pitch});
      }
    });
  }
  pedal({owner,channel=0,down}) {
    return this.run(async()=>{
      const entry=this.owner(owner,channel,!!down);
      if (!entry) return;
      entry.pedal=!!down;
      for (const part of entry.parts) await this.rpc('daw-live-pedal',{channel:entry.channel,part,down:down?1:0});
    });
  }
  releaseOwner(owner,channel) {
    return this.run(async()=>{
      for (const entry of this.owners.values()) {
        if (entry.label!==owner || (channel!==undefined && entry.originalChannel!==channel)) continue;
        for (const part of entry.parts) await this.rpc('daw-live-stop-part',{channel:entry.channel,part});
        this.owners.delete(entry.key);
      }
    });
  }
  setSources(entries) {
    return this.run(async()=>{
      const next=normalizeSources(entries);
      if (next.length!==this.sources.length || next.some((source,i)=>source.id!==this.sources[i].id ||
          JSON.stringify(source.instrument)!==JSON.stringify(this.sources[i].instrument))) throw Error('Release Fusion monitoring before replacing source instruments.');
      const project={...this.project,tracks:this.project.tracks.map((track,i)=>({...track,
        volume:next[i].volume,pan:next[i].pan,fx:next[i].fx}))};
      validateProject(project);validateEffects(project);
      this.workspace.player.updateMix(project);
      this.sources=next;this.project=project;
    });
  }
  close() {
    if (this.closing) return this.closing;
    this.job.signal.removeEventListener('abort',this.abort);
    this.closing=this.queue.then(async()=>{
      const player=this.workspace.player;
      try {
        if (player.speaker) player.speaker.gain.value=0;
        await this.rpc('daw-live-close');
      }finally{
        try {await player.endExport(this.job);}
        finally {this.owners.clear();unlock(this.workspace,this.job);this.didClose();}
      }
    });
    return this.closing;
  }
}

export async function openFusionMonitor(workspace,entries,{masterFx=[],signal,onError}={}) {
  const sources=normalizeSources(entries),project=sourceProject(sources,masterFx);
  const slots=assignSlots(project),job=reserve(workspace,signal,true),player=workspace.player;
  try {
    await prepareProjectSamplers(player,project,{signal:job.signal});
    await player.beginExport(job);
    const rpc=(type,data)=>player.requests().request(type,{...data,exportToken:job.token});
    const state=await rpc('daw-state-request');
    await rpc('daw-apply',{projectId:project.id,revision:0,token:state.token,
      slots:project.tracks.map(track=>({...track.instrument,trackId:track.id,part:slots.get(track.id)}))});
    await player.configureTracks(project,slots,project.id);
    await rpc('daw-live-open',{projectId:project.id,token:job.token});
    for (const track of player.tracks.values()) await track.gateRpc.request('live-session',{token:job.token});
    player.liveMix(new Set(slots.keys()));
    job.signal.throwIfAborted();
    player.speaker.gain.value=1;
    return new FusionMonitor(workspace,job,sources,project,slots,onError);
  }catch(error){
    try {await player.endExport(job);}
    finally {unlock(workspace,job);}
    throw error;
  }
}
