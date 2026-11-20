// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {emptyProject,makeTrack,PPQ,uuid} from '../../web/daw-project.js';
import {midiWindow} from '../../web/daw-clip-window.js';
import {applyFusionPhrase} from '../../web/sampler-fusion-phrase.js';

const project=emptyProject(),template=()=>({...structuredClone(project),tracks:[makeTrack('midi','Quiet'),makeTrack('midi','Strong')]});
const note=(pitch,velocity,start)=>({id:uuid(),pitch,velocity,start,duration:PPQ/4});
const clip={id:uuid(),type:'midi',name:'Two attacks',trackId:uuid(),position:{unit:'ticks',value:3*PPQ},
  loop:true,loopLength:PPQ,length:2*PPQ,offsetTicks:PPQ/8,
  notes:[note(55,38,0),note(66,100,PPQ/2)],midiEvents:[{id:uuid(),type:'cc',channel:0,controller:64,value:64,tick:0}]};
const sources=[{key:[55,60],velocity:[1,60],transpose:0},{key:[60,75],velocity:[61,127],transpose:-12}];
const input=JSON.stringify(clip),phrase={clip,bpm:90};
const rendered=applyFusionPhrase(template(),sources,phrase,{release:.5});
assert.equal(rendered.bpm,90);assert.equal(rendered.length,2*PPQ+.75*PPQ);
assert.equal(rendered.clips.length,2);
for(const [i,copy] of rendered.clips.entries()){
  assert.deepEqual(copy.position,{unit:'ticks',value:0});
  assert.equal(copy.trackId,rendered.tracks[i].id);
  assert.deepEqual([...new Set(midiWindow(copy).notes.map(n=>n.pitch))],[i?54:55]);
  assert.equal(copy.notes[0].velocity,i?100:38);
  assert(midiWindow(copy).events.length>=2);
}
assert.equal(JSON.stringify(clip),input);
assert.throws(()=>applyFusionPhrase(template(),sources,{...phrase,clip:{...clip,notes:[]}}),/MIDI clip/);
console.log('PASS DAW phrase tempo, loops, trim, velocity zones, transpose, CC and immutable source');
