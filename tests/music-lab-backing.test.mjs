// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {backingPlan,harmonyAt,labBackingClock,loopFrame,observedHarmony} from '../web/music-lab-backing.js';
import {LabPhrase} from '../web/music-lab-phrase.js';
import {MusicLabPreview} from '../web/music-lab-preview.js';
import {labMidiEvent} from '../web/music-lab-assessment.js';
import {practiceProject} from '../web/music-lab-project.js';
import {projectBlob,readProject} from '../web/daw-format.js';

const pop=backingPlan({form:'pop',tonic:'C',style:'harmony',bpm:72});
assert.equal(pop.lengthTick,7680);
assert.deepEqual(pop.harmony.map(v=>v.label),['C','G','Am','F']);
assert.deepEqual(pop.notes.slice(0,4).map(n=>[n.midi,n.startTick]),[[48,0],[55,960],[60,480],[64,480]]);
assert.equal(harmonyAt(pop,7690).label,'C');
const click=backingPlan({form:'minor',tonic:'C#',style:'click',bar:2,bpm:72});
assert.deepEqual(click.notes,[]);
assert.equal(click.harmony[0].label,'C♯m');
assert.equal(loopFrame(44099,22049.6),0);
const context={sampleRate:44100,getOutputTimestamp:()=>({contextTime:1,performanceTime:2000})};
assert.equal(observedHarmony(pop,0,2000,context,2001).label,'C');
assert.equal(observedHarmony(pop,44100,2000,context,2001),null);

const pitches=[],updates=[];
const engine={sim_track:()=>0,sim_seq_transpose:()=>0,sim_engine:()=>0,waswan_mode:()=>0,
  waswan_part_limit:()=>256,waswan_voice_limit:()=>256,waswan_voice:()=>0,
  waswan_studio_mix_value:(p,field)=>field===0?100:0,
  waswan_studio_note:(part,note,velocity)=>{pitches.push([part,note,velocity]);return 1;}};
const preview=new MusicLabPreview({engine:()=>engine,conflict:()=>false,layered:()=>false,notify:m=>updates.push(m)});
preview.start({...click,token:'click',backing:true,level:50},0,44100);
assert.equal(labBackingClock.click.level,.5);
preview.tick(256);
assert.deepEqual(pitches,[]);
preview.start({...pop,token:'notes',backing:true,level:50},128,44100);
preview.tick(384);
assert.deepEqual(pitches,[[0,48,52]]);
preview.mix('old',0);
assert.equal(labBackingClock.click.level,.5);
preview.mix('notes',0);
assert.deepEqual(pitches,[[0,48,52],[0,48,0]]);
assert.equal(preview.clock.active,true);
assert.equal(labBackingClock.click.enabled,false);
preview.stop('done');
assert.equal(labBackingClock.playing,false);

const send=(session,st,n,v,at)=>session.input(labMidiEvent({data:[st,n,v],timeStamp:at}));
const plain=new LabPhrase({channel:null,capture:false,chordAt:()=>pop.harmony[0]});
assert.deepEqual(send(plain,0x90,61,76,100),{kind:'phrase',pitch:61,chord:'C',structural:false});
send(plain,0x80,61,0,225);
assert.equal(plain.result(72).attacks,1);
assert.deepEqual(plain.result(72).notes,[]);
const captured=new LabPhrase({channel:0,capture:true,chordAt:()=>null});
send(captured,0x90,61,76,100);
send(captured,0x80,61,0,600);
send(captured,0x90,67,92,850);
send(captured,0x90,67,0,1350);
const take=captured.result(60);
assert.deepEqual(take.notes,[{midi:61,startTick:0,durationTick:240,velocity:76},{midi:67,startTick:360,durationTick:240,velocity:92}]);
assert.equal(take.space,1);
const project=practiceProject({name:'Independent practice',bpm:take.bpm,sources:[{label:'Phrase',notes:take.notes}]});
assert.equal(project.ppq,960);
assert.equal(project.version,4);
assert.equal(project.clips[0].notes[1].start,720);
assert.equal(project.clips[0].notes[1].duration,480);
const copy=await readProject(await projectBlob(project,new Map()));
assert.equal(copy.project.clips[0].notes[0].pitch,61);
console.log('PASS W4: deterministic accompaniment and shared clock, isolated mute, descriptive phrase, opt-in capture and DAW copy');
