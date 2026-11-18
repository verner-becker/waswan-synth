// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {DawPlayer} from '../web/daw-player.js';
import {ProjectController} from '../web/daw-controller.js';
import {emptyProject,makeTrack} from '../web/daw-project.js';
import {StudioRecorder} from '../web/studio-recorder.js';
const p=emptyProject(),t=makeTrack('midi','Shared Synth part');t.instrument={type:'analog',patch:Array(80).fill(0)};p.tracks.push(t);
const controller=new ProjectController(p),player=new DawPlayer({});player.projectId=p.id;player.slots.set(t.id,0);player.boundPatches.set(t.id,[...t.instrument.patch]);
const accepted=[...t.instrument.patch];accepted[12]=55;
assert.equal(player.synchronize(controller,[{part:0,patch:accepted}]),1);assert.equal(controller.snapshot().tracks[0].instrument.patch[12],55);assert(controller.dirty);
assert.equal(player.synchronize(controller,[{part:0,patch:accepted}]),0,'unchanged polling does not create edits');
const offline=[...accepted];offline[12]=70;controller.command('track.update',{id:t.id,changes:{instrument:{type:'analog',patch:offline}}});
accepted[12]=60;assert.equal(player.synchronize(controller,[{part:0,patch:accepted}]),0);assert.equal(controller.snapshot().tracks[0].instrument.patch[12],70,'pending preset/Undo is not overwritten by the old live binding');
player.invalidateBinding();assert.equal(player.synchronize(controller,[{part:0,patch:Array(80).fill(0)}]),0);assert.equal(controller.snapshot().tracks[0].instrument.patch[12],70,'reset engine is not an accepted timbre edit');
const recorder=Object.create(StudioRecorder.prototype);recorder.bridge={isDawBusy:()=>true,getAudio:()=>{throw Error('Must reject before touching audio');}};await assert.rejects(()=>recorder.play(),/Stop DAW/);
let resume;recorder.take={project:{frames:1}};recorder.state='ready';recorder.bridge={isDawBusy:()=>false,getAudio:()=>({gain:{},context:{resume:()=>new Promise(resolve=>{resume=resolve;})}})};
const playing=recorder.play();assert(recorder.playbackPreparing);recorder.stopPlayback();resume();await playing;assert(!recorder.player);assert(!recorder.playbackPreparing,'cancel during resume cannot start later');
console.log('PASS DAW player: accepted Synth changes update saved track; unchanged polls and staged offline edits preserve history');
