// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {RATE,MAX_FRAMES,MAX_EVENTS,MAGIC,wavHeader,pcm16,validateProject,projectBlob,readProject} from '../web/studio-format.js';
const context={version:1,tempo:120,master:724,session:'A'.repeat(458752),parts:Array.from({length:4},()=>({program:1,engine:0,parameters:Array(63).fill(0)}))};
const project={format:'waswan-studio-project',version:1,name:'Test',status:'complete',frames:128,sampleRate:RATE,channels:2,context,events:[{kind:'input',frame:10,receivedFrame:11,listening:true,data:[144,60,100]},{kind:'command',frame:12,command:{t:'midi',st:144,d1:60,d2:100}}]};
const audio=new Blob([wavHeader(128),new Uint8Array(128*4)],{type:'audio/wav'}),bytes=projectBlob(project,audio);
const recovered=await readProject(bytes);assert.deepEqual(recovered.project,project);assert.deepEqual(await recovered.audio.arrayBuffer(),await audio.arrayBuffer());
assert.deepEqual(Array.from(pcm16(new Float32Array([-2,-1,-.5,0,.5,1,2]))),[-32768,-32768,-16384,0,16384,32767,32767]);
assert.throws(()=>pcm16(new Float32Array([NaN])));assert.throws(()=>wavHeader(MAX_FRAMES+1));
for(const edit of [p=>p.version=2,p=>p.frames=-1,p=>p.frames=MAX_FRAMES+1,p=>p.events=Array(MAX_EVENTS+1).fill(null),p=>p.events[0].data[1]=128,p=>p.events[0].frame=129,p=>p.events[1].command.t='eval',p=>p.context.parts[0].parameters=[],p=>p.events[1].command.value={code:'unsafe'}]){
  const p=structuredClone(project);edit(p);assert.throws(()=>validateProject(p));
}
await assert.rejects(()=>readProject(new Blob(['bad'])));
await assert.rejects(()=>readProject(new Blob([bytes.slice(0,bytes.size-1)])));
const altered=new Uint8Array(await bytes.arrayBuffer());altered[0]=0;await assert.rejects(()=>readProject(new Blob([altered])));
const invalidWav=new Uint8Array(await bytes.arrayBuffer());invalidWav[invalidWav.length-128*4-44]=0;await assert.rejects(()=>readProject(new Blob([invalidWav])));
assert.equal(new TextDecoder().decode((await bytes.arrayBuffer()).slice(0,MAGIC.length)),MAGIC);
console.log('PASS Studio: PCM clipping, project/audio roundtrip, version, size, events, payload and WAV validation');
