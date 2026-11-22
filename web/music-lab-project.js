// SPDX-License-Identifier: GPL-3.0-only
import {emptyProject,makeTrack,PPQ,uuid,validateProject} from './daw-project.js';
import {projectBlob} from './daw-format.js';

export function practiceProject({name,bpm,meter=[4,4],sources}) {
  const project={...emptyProject(),name:name.slice(0,120),bpm,meter};
  let length=0;
  const ratio=PPQ/480;
  for(const {label,notes} of sources){
    if(!notes.length)continue;
    const track=makeTrack('midi',label);
    const clipNotes=notes.map(({midi,velocity=86,startTick,durationTick})=>({
      id:uuid(),pitch:midi,velocity,start:startTick*ratio,duration:durationTick*ratio
    }));
    const end=Math.max(...clipNotes.map(n=>n.start+n.duration));
    length=Math.max(length,end);
    project.tracks.push(track);
    project.clips.push({id:uuid(),type:'midi',trackId:track.id,name:label,position:{unit:'ticks',value:0},
      length:end,loopLength:end,loop:false,notes:clipNotes});
  }
  if(!length)throw Error('Nenhuma nota disponível para exportar.');
  project.length=length;
  project.transport={loop:false,start:0,end:length};
  validateProject(project);
  return project;
}

export async function downloadPracticeProject(options) {
  const project=practiceProject(options);
  const blob=await projectBlob(project,new Map());
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;
  link.download=project.name.replace(/[\\/:*?"<>|]/g,'-')+'.wsproj';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
