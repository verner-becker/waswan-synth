// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {MidiDiagnostic} from '../web/midi-diagnostic.js';
import {MidiInputController} from '../.local/www/simulator/midi.js';
let t=0;const d=new MidiDiagnostic({limit:8,now:()=>t++,stamp:()=>new Date(0).toISOString()});
assert.equal(d.input([176,48,1],{}),null);d.start();
for(const raw of [[144,60,100],[224,0,64],[240,1,2],[176,48,128]])assert.equal(d.input(raw,{}),null);
d.frame({knobControl:{context:1,parameters:[{id:12,value:40},null,null,null]}});
let r=d.input([181,48,10],{mode:'absolute',behavior:'fine'});assert.equal(r.rawDelta,null);assert.equal(r.channel,6);assert.equal(r.latestFrame.parameters[0].value,40);
r=d.input([181,48,127],{});assert.equal(r.rawDelta,117);r=d.input([181,48,127],{});assert.equal(r.rawDelta,0);
d.reset();assert.equal(d.input([181,48,3],{}).rawDelta,null);d.add('marker',{label:'problema observado'});assert.equal(d.active,false);assert.equal(d.records.at(-1).reason,'record-limit');
assert(d.records.length<=9);const rows=d.jsonl().trim().split('\n').map(JSON.parse);assert(rows.every(x=>x.session===rows[0].session));
// Input forwarding is identical with diagnostic capture disabled/enabled.
async function fixture(capture){const sent=[],source={id:'test',name:'private source name',state:'connected',async open(){},async close(){}};
 const c=new MidiInputController({navigator:{async requestMIDIAccess(){return {inputs:new Map([['test',source]])};}},secureContext:true,send:m=>sent.push(m),isRunning:()=>true,isListening:()=>true});
 await c.connect();c.profile.setEnabled(true);c.profile.learn('enc:0','absolute','fine');c.profile.setContext(42);c.message([181,48,40]);if(capture)c.diagnostic.start();
 for(const raw of [[181,48,41],[181,48,43],[144,60,100],[224,0,80],[176,64,127],[128,60,0],[176,123,0]])c.message(raw);
 return {sent,c};}
const off=await fixture(false),on=await fixture(true);assert.deepEqual(on.sent,off.sent);const cc=on.c.diagnostic.records.filter(r=>r.type==='cc'&&r.cc===48);assert.equal(cc[0].profilePrevious,40);assert.equal(cc[0].commands[0].steps,1);assert.equal(cc[1].commands[0].steps,2);assert.equal(cc[0].disposition,'mapped-command-sent');
assert(!on.c.diagnostic.jsonl().includes('private source name'));assert(!on.c.diagnostic.records.some(r=>r.raw?.[0]===144));
console.log('PASS MIDI diagnostic: optional, bounded, CC-only, raw deltas, frame snapshots, exact forwarding, markers and privacy');
