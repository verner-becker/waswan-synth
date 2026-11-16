// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {MODES,selectVoiceMode} from '../web/polyphony-panel.js';
const sent=[],controller={isRunning:()=>true,release:()=>sent.push('release'),send:m=>sent.push(m)};
const frame={track:2,engines:[0,0,0,0],midiMode:false};
assert.deepEqual(MODES.map(m=>m.label),['POLY','MONO','DUAL','UNISON']);
for(const {id} of MODES){assert.equal(selectVoiceMode(controller,frame,id),true);assert.deepEqual(sent.splice(0),['release',{t:'voice-mode',part:2,mode:id}]);}
for(const invalid of [null,{...frame,midiMode:true},{...frame,engines:[0,0,2,0]}])assert.equal(selectVoiceMode(controller,invalid,0),false);
assert.equal(selectVoiceMode({...controller,isRunning:()=>false},frame,0),false);
for(const invalid of [-1,4,'0',NaN])assert.equal(selectVoiceMode(controller,frame,invalid),false);
assert.deepEqual(sent,[]);
console.log('PASS shared voice-mode action: original release/send, selected part, four modes, stopped/DRUM/MIDI-mode guards');
