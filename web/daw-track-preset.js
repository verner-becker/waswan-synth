// SPDX-License-Identifier: GPL-3.0-only
import {emptyProject,makeTrack,uuid,validateProject} from './daw-project.js';
import {validateEffects} from './daw-fx-catalog.js';

const signature='waswan-daw-preset';
const extension='.wspreset';
const types=[{description:'WASWAN track or instrument preset',accept:{'application/json':[extension]}}];
const mixer=['name','icon','color','volume','pan','monitor','instrument','fx'];
function pick(object,fields){return Object.fromEntries(fields.map(key=>[key,structuredClone(object[key])]));}

export function trackPreset(track,kind){
  if(!['track','instrument'].includes(kind)||kind==='instrument'&&!track.instrument)
    throw Error('Choose an instrument to save this preset');
  const values=kind==='track'?pick(track,mixer):pick(track,['instrument']);
  const preset={format:signature,version:1,kind,type:track.type,values};
  presetChanges(track,preset);
  return preset;
}
export function presetChanges(track,preset){
  if(preset?.format!==signature||preset.version!==1||!['track','instrument'].includes(preset.kind)||
    preset.type!==track.type||preset.kind==='instrument'&&(track.type!=='midi'||!preset.values?.instrument))
    throw Error('Choose a matching WASWAN track or instrument preset');
  const changes=pick(preset.values||{},preset.kind==='track'?mixer:['instrument']);
  if(changes.fx)changes.fx=changes.fx.map(e=>({...e,id:uuid()}));
  const candidate=emptyProject();
  candidate.tracks.push({...makeTrack(track.type),...changes});
  validateProject(candidate);validateEffects(candidate);
  return changes;
}
export async function saveTrackPreset(track,kind){
  const preset=trackPreset(track,kind);
  const handle=await showSaveFilePicker({types,suggestedName:track.name.replace(/[\\/:*?"<>|]/g,'-')+extension});
  const writer=await handle.createWritable();
  try{await writer.write(JSON.stringify(preset));await writer.close();}
  catch(error){await writer.abort().catch(()=>{});throw error;}
  return handle.name;
}
export async function loadTrackPreset(controller,track){
  const revision=controller.revision;
  const [handle]=await showOpenFilePicker({types,multiple:false});
  const file=await handle.getFile();
  if(file.size>128*1024)throw Error('Preset file exceeds 128 KiB');
  const changes=presetChanges(track,JSON.parse(await file.text())),project=controller.snapshot();
  if(controller.revision!==revision)throw Error('Project changed while choosing the preset');
  validateEffects({...project,tracks:project.tracks.map(t=>t.id===track.id?{...t,...changes}:t)});
  controller.command('track.update',{id:track.id,changes});
  return handle.name;
}
