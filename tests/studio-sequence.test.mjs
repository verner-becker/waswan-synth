// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {PPQ,emptySequence,validateSequence,inputNotes,compileNotes,smf,tickFrame,musicalPosition} from '../web/studio-sequence.js';
const s=emptySequence();s.notes=[{id:'one',part:0,note:60,velocity:100,start:0,duration:PPQ},{id:'two',part:1,note:64,velocity:80,start:PPQ,duration:PPQ}];
const compiled=compileNotes(s);assert.equal(compiled.events[0].frame,0);assert.equal(compiled.events[1].velocity,0);assert.equal(compiled.events[2].velocity,80);assert.equal(compiled.length,352800);
assert.equal(tickFrame(960,120),22050);assert.equal(tickFrame(960,240),11025);
assert.equal(musicalPosition(0,s),'001:01:000');assert.equal(musicalPosition(88200,s),'002:01:000');
for(const bad of [q=>q.bpm=0,q=>q.notes[0].part=4,q=>q.notes[0].duration=0,q=>q.notes[0].start=-1,q=>q.notes[1].id='one',q=>q.notes[0].note=128,q=>q.length=PPQ/4]){const q=structuredClone(s);bad(q);assert.throws(()=>validateSequence(q));}
const notes=inputNotes({context:{tempo:120},frames:44100,events:[{kind:'input',frame:0,data:[144,60,100]},{kind:'command',frame:20,command:{t:'midi'}},{kind:'input',frame:22050,data:[144,60,0]},{kind:'input',frame:30000,listening:false,data:[144,62,80]}]});
assert.equal(notes.notes.length,1);assert.equal(notes.notes[0].duration,960);
const expressive=inputNotes({context:{tempo:120,selectedPart:2},frames:44100,events:[{kind:'input',frame:0,data:[144,60,100]},{kind:'input',frame:100,data:[224,0,80]},{kind:'input',frame:200,data:[176,64,127]},{kind:'input',frame:22050,data:[128,60,0]}]});
assert.equal(expressive.notes[0].part,2);assert.deepEqual(expressive.expression.map(e=>e.data[0]),[226,178]);assert.doesNotThrow(()=>smf(expressive));
const bytes=smf(s);assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'MThd');assert.equal(new DataView(bytes.buffer).getUint16(10),5);
// Parse every track and delta, not just the serializer's header.
let offset=14;const decoded=[];
for(let t=0;t<5;t++){
  assert.equal(new TextDecoder().decode(bytes.slice(offset,offset+4)),'MTrk');const size=new DataView(bytes.buffer).getUint32(offset+4),end=offset+8+size;offset+=8;let tick=0;
  const vlq=()=>{let value=0,b;do{b=bytes[offset++];value=value*128+(b&127);}while(b&128);return value;};
  while(offset<end){tick+=vlq();const status=bytes[offset++];if(status===255){offset++;const length=vlq();offset+=length;}else{decoded.push({tick,status,note:bytes[offset++],velocity:bytes[offset++]});}}
  assert.equal(offset,end);
}
assert.equal(offset,bytes.length);assert.equal(decoded.length,4);assert(decoded.some(e=>e.tick===960&&e.status===128&&e.note===60));
console.log('PASS Studio sequence: musical timing, input note extraction, range guards and independently parsed SMF tracks/events');
