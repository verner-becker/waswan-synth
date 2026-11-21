// SPDX-License-Identifier: GPL-3.0-only
import {emptyProject,makeTrack,PPQ} from './daw-project.js';
import {planAudioExport} from './daw-audio-export.js';
import {validateInstrument} from './sampler-instrument.js';
import {importOriginal,prepareInstrument,readSampleFile} from './sampler-library.js';
import {labMaxSeconds} from './sampler-lab-analysis.js';
import {runOffline} from './sampler-offline.js';
import {createWorking,previewWorkingWav,renderWorking,workingInstrument} from './sampler-working.js';
import {inspectWav} from './sampler-wav.js';
import {mapSample,stageWorkingSampler} from './sampler.js';
import {pitchAdapters,pitchRecipe} from './sampler-lab-pitch.js';

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
  const sample=await previewIdentity(file,'lab-preview');
  const model={...mapSample(sample,draft.rootNote,{name:draft.name}),id:draft.instrumentId};
  return {file,sample,model,region:model.regions[0],transient:true};
}

async function digestBytes(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    b=>b.toString(16).padStart(2,'0')).join('');
}

async function previewIdentity(file,id) {
  const {sampleRate,channels,frames}=await inspectWav(file);
  const sha256=await digestBytes(await file.arrayBuffer());
  return {id,path:'Samples/Preview/'+id+'.wav',frames,channels,sampleRate,sha256,size:file.size};
}

export async function prepareLabPreview(player,root,source,model,variant) {
  const previewFiles=new Map();
  if(source.transient)previewFiles.set(source.sample.id,source.file);
  if(variant)previewFiles.set(variant.sample.id,variant.file);
  return stageWorkingSampler(player,await prepareInstrument(root,model,{previewFiles}));
}

export async function renderLabPitch(source,region,{semitones,fine,formants=true},{run=runOffline,algorithm='wsola'}={}) {
  const adapter=pitchAdapters[algorithm];
  if(!adapter||adapter.id==='native-hermite')throw Error('Choose an available offline pitch processor.');
  if(region.fixedPitch)throw Error('Choose a chromatic region for pitch comparison.');
  if(!Number.isInteger(semitones)||!Number.isFinite(fine)||Math.abs(fine)>100||
     region.root+semitones<0||region.root+semitones>127)
    throw Error('Choose a valid anchor note and fine tuning between −100 and +100 cents.');
  const [start,end]=region.frames;
  const parameters={semitones:semitones+fine/100,...(adapter.parameters.formants?{formants}:{})};
  const result=await run(source.file,{type:'lab-pitch',range:{start,end},algorithm,parameters});
  const operation=pitchRecipe(adapter,result.parameters??parameters);
  const {wav,report}=result;
  const recipe=[{type:'trim',start,end},operation];
  const digest=await digestBytes(new TextEncoder().encode(JSON.stringify([source.sample.path,source.sample.sha256,recipe])));
  const sample=await previewIdentity(wav,'lab-'+digest.slice(0,32));
  return {sample,file:wav,report,semitones,fine,recipe,algorithm,algorithmVersion:adapter.version,
    regionId:region.id,sourceFrames:[start,end]};
}

export function markNativeLabRegion(model,regionId) {
  const region=model.regions.find(r=>r.id===regionId);
  if(region.sampleLab)return model;
  return labMap(model,regionId,{sampleLab:{version:1,algorithm:'native-hermite',algorithmVersion:1}});
}

export function pitchLabMap(model,variant,{sample=variant.sample,gain=0,offset=0}={}) {
  const region=model.regions.find(r=>r.id===variant.regionId);
  const [start,end]=variant.sourceFrames;
  const loop=region.loop&&{...region.loop,start:region.loop.start-start,end:region.loop.end-start};
  const pitched={...region,sample:sample.id,frames:[0,end-start],root:region.root+variant.semitones,
    cents:region.cents-variant.fine,gainDb:Math.max(-144,Math.min(48,region.gainDb+gain+offset)),loop,
    sampleLab:{version:1,algorithm:variant.algorithm,algorithmVersion:variant.algorithmVersion,outputGainDb:gain}};
  const regions=model.regions.map(r=>r.id===region.id?pitched:r);
  const samples=[...model.samples.filter(s=>regions.some(r=>r.sample===s.id)),sample];
  return validateInstrument({...model,samples,regions});
}

async function saveLabPitchSample(root,draft,model,variant) {
  const region=model.regions.find(r=>r.id===variant.regionId);
  const original=model.samples.find(s=>s.id===region.sample);
  const destination='Samples/Processed/'+draft.id+'/'+variant.sample.id+'.wav';
  return importOriginal(root,variant.file,destination,{
    id:variant.sample.id,source:{path:original.path,sha256:original.sha256},
    recipe:{version:1,operations:variant.recipe},license:original.license,
    provenance:{sampleLab:{version:1,algorithm:variant.algorithm,algorithmVersion:variant.algorithmVersion,
      semitones:variant.semitones,fine:variant.fine,formants:variant.recipe.at(-1).formants,anchor:variant.semitones+region.root}},
  });
}

export async function persistLabPitch(root,draft,source,model,variant,gain) {
  const saved=await materializeLab(root,draft,source,model);
  const sample=await saveLabPitchSample(root,saved.draft,saved.model,variant);
  return {draft:saved.draft,model:pitchLabMap(saved.model,variant,{sample,gain}),sample};
}

export function labAnchorOffsets(model,variant) {
  const [region]=model.regions;
  if(model.regions.length!==1||!variant?.semitones||region.fixedPitch||region.variation||
    region.keyFadeIn||region.keyFadeOut||region.root<region.key[0]||region.root>region.key[1])return [];
  return [variant.semitones,-variant.semitones].filter(offset=>
    region.root+offset>=region.key[0]&&region.root+offset<=region.key[1]);
}

export async function persistLabAnchors(root,draft,source,model,variant,gain,{run=runOffline}={}) {
  const offsets=labAnchorOffsets(model,variant);
  if(!offsets.length)throw Error('Choose a single chromatic region and a nonzero anchor shift inside its key range.');
  const saved=await materializeLab(root,draft,source,model,{run});
  const base=markNativeLabRegion(saved.model,saved.model.regions[0].id).regions[0];
  const samples=[...saved.model.samples],regions=[base];
  for(const offset of offsets){
    const pitch=offset===variant.semitones?variant:await renderLabPitch(source,model.regions[0],
      {semitones:offset,fine:-variant.fine,formants:variant.recipe.at(-1).formants},{run,algorithm:variant.algorithm});
    const sample=await saveLabPitchSample(root,saved.draft,saved.model,pitch);
    const shifted=pitchLabMap(saved.model,pitch,{sample,gain}).regions[0];
    samples.push(sample);
    regions.push({...shifted,id:'lab-anchor-'+shifted.root});
  }
  regions.sort((a,b)=>a.root-b.root);
  const boundaries=regions.slice(1).map((region,i)=>Math.floor((regions[i].root+region.root)/2));
  const mapped=regions.map((region,i)=>({...region,key:[i?boundaries[i-1]+1:base.key[0],boundaries[i]??base.key[1]]}));
  return {draft:saved.draft,model:validateInstrument({...saved.model,samples,regions:mapped})};
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
  const {root,key}=region;
  const within=note=>note>=key[0]&&note<=key[1];
  const center=Math.max(key[0],Math.min(key[1],root));
  const testNote=(note,start=0,duration=1.5,velocity=100)=>({note,start,duration,velocity});
  const tests=[0,12,-12,24,-24].filter(offset=>within(root+offset)).map(offset=>({
    id:'note-'+offset,label:offset?'Root '+(offset>0?'+':'')+offset+' semitones':'Root · hold',
    notes:[testNote(root+offset)],monophonic:true,held:true,
  }));
  const spread=[0,-12,7,12,-5,4,5,-7,3,-3,1,-1];
  const chord=spread.map(delta=>center+delta).filter(within);
  for(let pitch=key[0];pitch<=key[1]&&chord.length<4;pitch++)if(!chord.includes(pitch))chord.push(pitch);
  if(chord.length>=4)tests.push({id:'chord',label:'Four-note chord',notes:chord.slice(0,4).map(n=>testNote(n)),held:true});
  const sequence=[0,7,-5,12].map(delta=>center+delta).filter(within);
  tests.push({id:'short',label:'Short notes',notes:[...sequence,...sequence].map((n,i)=>testNote(n,.15*i,.09))},
    {id:'velocity',label:'Velocity steps',notes:[32,64,96,127].map((v,i)=>testNote(center,.42*i,.22,v))},
    {id:'release',label:'Note Off & release',notes:[testNote(center,0,1,100)],monophonic:true,held:true});
  return tests.map(test=>({...test,heldFrom:.6}));
}

export function labTestTailMs(model,test) {
  const lastOff=Math.max(...test.notes.map(note=>note.start+note.duration));
  let tail=0;
  for(const region of model.regions){
    if(region.mode==='gate'&&region.trigger==='attack'){
      tail=Math.max(tail,labEnvelope(model,region).releaseMs/1000);
      continue;
    }
    const sample=model.samples.find(s=>s.id===region.sample);
    const frames=region.frames[1]-region.frames[0],group=model.groups.find(g=>g.id===region.group);
    for(const note of test.notes){
      if(note.note<region.key[0]||note.note>region.key[1])continue;
      const cents=(region.fixedPitch?0:100*(note.note-region.root))+region.cents+group.cents+model.cents;
      const from=note.start+(region.trigger==='release'?note.duration:0);
      tail=Math.max(tail,from+frames/(sample.sampleRate*2**(cents/1200))-lastOff);
    }
  }
  return Math.min(60000,tail*1000);
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
