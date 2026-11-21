// SPDX-License-Identifier: GPL-3.0-only
import {emptyProject,makeTrack,PPQ} from './daw-project.js';
import {planAudioExport} from './daw-audio-export.js';
import {compile,samplerLimits,validateInstrument} from './sampler-instrument.js';
import {readSampleFile} from './sampler-library.js';
import {labMaxSeconds} from './sampler-lab-analysis.js';
import {runOffline} from './sampler-offline.js';
import {createWorking,prepareWorking,previewWorkingWav,renderWorking,workingInstrument} from './sampler-working.js';
import {decodeWav,inspectWav} from './sampler-wav.js';
import {mapSample,stageWorkingSampler} from './sampler.js';

export const labEnvelopes=Object.freeze({
  'Vocal Sustain':{attackMs:5,decayMs:80,sustain:.9,releaseMs:140},
  'Guitar Pluck':{attackMs:1,decayMs:240,sustain:.32,releaseMs:95},
  'Organ':{attackMs:3,decayMs:0,sustain:1,releaseMs:25},
  'Pad':{attackMs:450,decayMs:700,sustain:.75,releaseMs:1000},
  'Percussive':{attackMs:1,decayMs:110,sustain:0,releaseMs:35},
});
const defaultEnvelope={attackMs:0,decayMs:0,sustain:1,releaseMs:5};

export function labEnvelope(model,region) {
  return {...(region.envelope??model.groups.find(g=>g.id===region.group).envelope??model.envelope??defaultEnvelope)};
}

export function labMap(model,regionId,changes) {
  return validateInstrument({...model,regions:model.regions.map(r=>r.id===regionId?{...r,...changes}:r)});
}

export async function labSource(root,draft,regionId,{run=runOffline}={}) {
  if(draft.instrument){
    const model=workingInstrument(draft);
    const region=model.regions.find(r=>r.id===regionId)??model.regions[0];
    if(!region)throw Error('Add a playable region in Instrument Builder first.');
    const sample=model.samples.find(s=>s.id===region.sample);
    return {model,region,sample,file:await readSampleFile(root,sample)};
  }
  if((draft.selection[1]-draft.selection[0])/draft.source.sampleRate>labMaxSeconds&&!draft.rendered)
    throw Error('Select a playable excerpt of up to 16 seconds in Sample Editor before opening the lab.');
  if(draft.rendered || (draft.source.sampleRate===44100&&draft.recipe.every(op=>op.bypass)&&
      draft.selection[0]===0&&draft.selection[1]===draft.source.frames)){
    const model=workingInstrument(draft);
    return {model,region:model.regions[0],sample:model.samples[0],
      file:await readSampleFile(root,model.samples[0])};
  }
  const file=await previewWorkingWav(root,draft,{run});
  const {sampleRate,channels,frames}=await inspectWav(file);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),
    b=>b.toString(16).padStart(2,'0')).join('');
  const sample={id:'lab-preview',path:'Samples/Preview.wav',frames,channels,sampleRate,sha256};
  const model={...mapSample(sample,draft.rootNote,{name:draft.name}),id:draft.instrumentId};
  return {file,sample,model,region:model.regions[0],transient:true};
}

export async function prepareLabPreview(player,root,draft,source,model) {
  if(!source.transient) return prepareWorking(player,root,{...draft,instrument:model});
  const plan=compile(model);
  if(source.sample.frames*source.sample.channels*2>samplerLimits.memoryBytes)
    throw Error('Choose an excerpt that fits the shared PCM budget.');
  const {pcm}=await decodeWav(source.file);
  return stageWorkingSampler(player,{plan,samples:new Map([[source.sample.id,pcm]])});
}

export async function materializeLab(root,draft,source,model,options={}) {
  if(!source.transient)return {draft,model};
  const rendered=await renderWorking(root,draft,options);
  const sample=rendered.rendered;
  if(sample.sha256!==source.sample.sha256)throw Error('The render changed since preview. Reopen Sample Lab to check the source.');
  return {draft:rendered,model:validateInstrument({...model,samples:[sample],
    regions:model.regions.map(region=>({...region,sample:sample.id}))})};
}

export function forkLabWorking(draft,model,name) {
  const {libraryId,source,selection,recipe,rootNote,rendered,sliceMarkers}=draft;
  const id=crypto.randomUUID();
  return createWorking({libraryId,source,selection,recipe,rootNote,rendered,sliceMarkers,name,
    instrument:validateInstrument({...model,id,revision:0,name})});
}

export function labTests(region) {
  const {root,key,cents}=region;
  const within=note=>note>=key[0]&&note<=key[1];
  const center=Math.max(key[0],Math.min(key[1],root));
  const testNote=(note,start=0,duration=1.5,velocity=100)=>({note,start,duration,velocity});
  const tests=[0,12,-12,24,-24].filter(offset=>within(root+offset)).map(offset=>({
    id:'note-'+offset,label:offset?'Root '+(offset>0?'+':'')+offset+' semitones':'Root · hold',
    notes:[testNote(root+offset)],monophonic:true,
  }));
  const spread=[0,-12,7,12,-5,4,5,-7,3,-3,1,-1];
  const chord=spread.map(delta=>center+delta).filter(within);
  for(let pitch=key[0];pitch<=key[1]&&chord.length<4;pitch++)if(!chord.includes(pitch))chord.push(pitch);
  if(chord.length>=4)tests.push({id:'chord',label:'Four-note chord',notes:chord.slice(0,4).map(n=>testNote(n))});
  const sequence=[0,7,-5,12].map(delta=>center+delta).filter(within);
  tests.push({id:'short',label:'Short notes',notes:[...sequence,...sequence].map((n,i)=>testNote(n,.15*i,.09))},
    {id:'velocity',label:'Velocity steps',notes:[32,64,96,127].map((v,i)=>testNote(center,.42*i,.22,v))},
    {id:'release',label:'Note Off & release',notes:[testNote(center,0,1,100)],monophonic:true});
  return tests.map(test=>({...test,heldFrom:.6,expectedHz:test.monophonic?
    440*2**((test.notes[0].note-69+cents/100)/12):null}));
}

export function labTestProject(ref,test,releaseMs) {
  const project=emptyProject(),tick=seconds=>Math.round(seconds*PPQ*project.bpm/60);
  const off=Math.max(...test.notes.map(n=>n.start+n.duration));
  project.name='Sample Lab '+test.label;
  project.length=tick(off+Math.max(.4,releaseMs/1000+.2));
  project.transport.end=project.length;
  const track={...makeTrack('midi','Sample Lab'),instrument:{...ref,path:'Instruments/Sample Lab preview'},volume:1,pan:0,fx:[]};
  project.tracks=[track];project.master={volume:1,fx:[]};
  project.clips=[{id:crypto.randomUUID(),type:'midi',trackId:track.id,name:test.label,position:{unit:'ticks',value:0},
    length:project.length,loopLength:project.length,loop:false,notes:test.notes.map(({note,start,duration,velocity})=>({
      id:crypto.randomUUID(),pitch:note,velocity,start:tick(start),duration:tick(duration),
    }))}];
  return {project,off};
}

export async function captureLabTest(workspace,ref,test,releaseMs,{signal,onProgress=()=>{}}={}) {
  const exporter=workspace.audioExport.exporter;
  if(workspace.busy||exporter.busy)throw Error('Finish the current DAW operation before testing.');
  exporter.checkIdle();
  const {project,off}=labTestProject(ref,test,releaseMs);
  const plan=planAudioExport(project,{scope:'mix',format:'wav'});
  const abort=new AbortController(),token=crypto.randomUUID();
  const job={token,abort,signal:signal?AbortSignal.any([signal,abort.signal]):abort.signal,fail:error=>abort.abort(error),restoreGraph:true,
    channelLevels:true};
  exporter.job=job;workspace.busy=true;workspace.refreshControls();
  try{
    const storage=await navigator.storage.getDirectory();
    const scratch=await storage.getDirectoryHandle('waswan-daw-exports-v1',{create:true});
    return await navigator.locks.request('waswan-daw-export:'+token,async()=>{
      const dir=await scratch.getDirectoryHandle(token,{create:true});
      try{
        const info=await exporter.capture(job,dir,plan,{snapshot:()=>project,assets:new Map(),revision:0},0,onProgress);
        // Materialize the File before removing the scratch entry.
        const saved=await(await dir.getFileHandle('0.wav')).getFile();
        const wav=new Blob([await saved.arrayBuffer()],{type:'audio/wav'});
        const metrics=await runOffline(wav,{type:'lab-performance',options:{off,heldFrom:test.heldFrom,monophonic:test.monophonic}},{signal:job.signal});
        return {wav,metrics,peak:info.peaks[0],clipped:info.clipped[0],channelLevels:info.channelLevels[0],off};
      }finally{await scratch.removeEntry(token,{recursive:true});}
    });
  }finally{exporter.job=null;workspace.busy=false;workspace.refreshControls();}
}
