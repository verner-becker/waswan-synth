// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {emptyProject,makeTrack,uuid} from '../web/daw-project.js';
import {projectBlob,readProject,fileToken} from '../web/daw-format.js';
import {wavHeader,projectBlob as studioBlob} from '../web/studio-format.js';
const p=emptyProject(),track=makeTrack('audio');p.tracks.push(track);
const pcm=Int16Array.from({length:256},(_,i)=>i*19),audio=new Blob([wavHeader(128),pcm]),meta={id:uuid(),name:'Source',frames:128,bytes:audio.size,sampleRate:44100,channels:2};p.assets.push(meta);
p.clips.push({id:uuid(),type:'audio',trackId:track.id,name:'Clip',assetId:meta.id,position:{unit:'seconds',value:1},offset:17,frames:80,gain:.7,pan:-.2,fadeIn:12,fadeOut:8});
const blob=await projectBlob(p,new Map([[meta.id,audio]])),restored=await readProject(blob);
assert.deepEqual(restored.project,p);assert.deepEqual(await restored.assets.get(meta.id).arrayBuffer(),await audio.arrayBuffer());
assert.notEqual(await fileToken(blob),await fileToken(await projectBlob(p,new Map([[meta.id,audio]]))),'every saved generation has a new identity');
const corrupted=new Uint8Array(await blob.arrayBuffer());corrupted[corrupted.length-2]^=1;await assert.rejects(readProject(new Blob([corrupted])),/checksum/);
await assert.rejects(readProject(blob.slice(0,blob.size-1)),/truncated/);
await assert.rejects(readProject(new Blob([blob,new Uint8Array(1)])),/Unexpected/);
await assert.rejects(projectBlob(p,new Map()),/Missing/);
const context={version:1,tempo:120,master:724,session:'A'.repeat(458752),parts:Array.from({length:4},()=>({program:1,engine:0,parameters:Array(63).fill(0),patch:Array(80).fill(0)}))};
for(const version of [1,2]){
 const old={format:'waswan-studio-project',version,name:'Old composition',status:'complete',frames:128,sampleRate:44100,channels:2,context,events:[{kind:'input',frame:10,receivedFrame:11,listening:true,data:[144,60,100]}],sequence:{version:1,ppq:960,bpm:120,meter:[4,4],length:15360,loop:false,notes:[{id:'old note with spaces',part:2,note:60,velocity:91,start:120,duration:240}]}};
 const assets=version===2?[{meta:{id:'old asset with spaces',name:'Old source',frames:128,bytes:audio.size},audio}]:[];
 if(version===2){old.assets=assets.map(a=>a.meta);old.sequence.audioClips=[{id:'old note with spaces',asset:old.assets[0].id,start:0,offset:0,frames:128,gain:.5,pan:.3,mute:false}];}
 if(version===1){old.sequence.clips=[{id:'empty name clip',name:'',part:2,start:0,length:15360}];old.sequence.notes[0].clip='empty name clip';}
 if(version===2){old.assets[0].name='';}
 const migrated=await readProject(studioBlob(old,audio,assets));
 assert.equal(migrated.project.version,3);assert.deepEqual(migrated.project.legacy.studio,old);assert(migrated.warnings.length);
 const note=migrated.project.clips.find(c=>c.type==='midi').notes[0];assert.equal(note.pitch,60);assert.equal(note.velocity,91);assert.equal(note.start,120);
 const migratedAgain=await readProject(await projectBlob(migrated.project,migrated.assets));assert.deepEqual(migratedAgain.project,migrated.project);
 for(const [id,bytes] of migrated.assets)assert.deepEqual(await migratedAgain.assets.get(id).arrayBuffer(),await bytes.arrayBuffer());
}
console.log('PASS DAW archive: byte-identical sources, checksums, truncation, extra data, missing assets, v1/v2 migration and source IDs without aliasing');
