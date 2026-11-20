// SPDX-License-Identifier: GPL-3.0-only
import {PPQ,uuid,validateProject} from './daw-project.js';

// Keep the clip's loop, trim, channels and expression intact. The DAW player
// resolves its MIDI window exactly as it does for the original project.
export function applyFusionPhrase(project,sources,{clip,bpm},{release=0}={}) {
  if(clip?.type!=='midi'||!Array.isArray(clip.notes)||!clip.notes.length)
    throw Error('Choose a DAW MIDI clip containing a phrase.');
  if(!Number.isFinite(bpm)||!Number.isFinite(release)||release<0)
    throw Error('The phrase needs a tempo and a nonnegative release window.');
  project.bpm=bpm;
  project.length=clip.length+Math.round(release*bpm*PPQ/60);
  project.transport.end=project.length;
  for(const [index,source] of sources.entries()){
    const notes=clip.notes.flatMap(note=>{
      if(note.pitch<source.key[0]||note.pitch>source.key[1]||
        note.velocity<source.velocity[0]||note.velocity>source.velocity[1])return [];
      const pitch=note.pitch+source.transpose;
      return pitch>=0&&pitch<=127?[{...note,pitch}]:[];
    });
    if(!notes.length)continue;
    project.clips.push({...structuredClone(clip),id:uuid(),trackId:project.tracks[index].id,
      position:{unit:'ticks',value:0},notes});
  }
  if(!project.clips.length)throw Error('No Fusion source covers the notes and velocities in this phrase.');
  return validateProject(project);
}
