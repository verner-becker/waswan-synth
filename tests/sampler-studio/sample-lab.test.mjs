// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {compileProject,assignSlots} from '../../web/daw-playback.js';
import {labLevels,labPerformanceMetrics,measureLabLoop,optimizeLabLoop} from '../../web/sampler-lab-analysis.js';
import {labEnvelope,labMap,labTestProject,labTests} from '../../web/sampler-lab.js';
import {createInstrument} from '../../web/sampler-instrument.js';
import {encodeSample,processWav} from '../../web/sampler-offline.js';

const sampleRate=44100,frames=sampleRate;
const sine=(gain=()=>.4)=>({sampleRate,channels:1,pcm:Float32Array.from({length:frames},(_,i)=>
  gain(i/sampleRate)*(Math.sin(2*Math.PI*220*i/sampleRate)+.1*Math.sin(2*Math.PI*440*i/sampleRate)))});
const audio=sine();
const candidates=optimizeLabLoop(audio,{start:0,end:frames});
assert.equal(candidates.length,3);
assert(candidates[0].metrics.ranges.every(r=>r.rippleDb<1));
assert(Math.abs(candidates[0].metrics.pitch.hz-220)<1);
assert.deepEqual(optimizeLabLoop(sine(t=>t<.20?.4:0),{start:0,end:frames}),[]);
assert.deepEqual(optimizeLabLoop(sine(t=>.04+.4*Math.sin(28*Math.PI*t)**8),{start:0,end:frames}),[]);
const good=measureLabLoop(audio,{start:0,end:22050,mode:'forward'});
const bad=measureLabLoop(audio,{start:0,end:22099,mode:'forward'});
assert(bad.seam>good.seam*8);
assert(good.ranges[0].cycleMs>good.ranges[1].cycleMs);
assert(good.ranges[1].cycleMs>good.ranges[2].cycleMs);
for(const mode of ['forward','reverse','pingPong']) {
  const metrics=measureLabLoop(audio,{start:400,end:13000,mode,crossfade:203},{reverse:true});
  assert(Number.isFinite(metrics.seam)&&metrics.rms>.01);
}
const source=await processWav(encodeSample(audio),{type:'lab-source',range:{start:100,end:20000}});
assert(source.levels[0].rail===0&&source.pitch.confidence>.9);
const summed={...audio,channels:2,pcm:Float32Array.from({length:2*frames},(_,i)=>{
  const at=i>>1;return audio.pcm[at]*(i%2?.5:4)*(at<frames*.75?1:0);
})};
assert(labLevels(summed)[0].rail>100);
assert.equal(labLevels(summed)[1].rail,0);
const capture=labPerformanceMetrics(summed,{off:.5,heldFrom:.2,monophonic:false});
assert(capture.tailMs>240&&capture.tailMs<=250);
const model=createInstrument({envelope:{attackMs:17},
  samples:[{id:'tone',path:'Samples/tone.wav',sha256:'a'.repeat(64),frames,sampleRate,channels:1}],
  regions:[{id:'tone',sample:'tone',group:'main',root:60,key:[45,78],velocityCurve:'linear'}]});
assert.equal(labEnvelope(model,model.regions[0]).attackMs,17);
const tuned=labMap(model,'tone',{envelope:{attackMs:60000,decayMs:0,sustain:0,releaseMs:60000}});
assert.equal(tuned.regions[0].envelope.releaseMs,60000);
assert.throws(()=>labMap(model,'tone',{envelope:{attackMs:60001}}),{field:'regions.0.envelope.attackMs'});
const scripts=labTests(model.regions[0]);
assert(!scripts.find(x=>x.id==='note-24'||x.id==='note--24'));
const ref={type:'sampler',libraryId:'lab',instrumentId:'tone',revision:1,patch:Array(80).fill(0)};
const {project}=labTestProject(ref,scripts.find(x=>x.id==='chord'),180);
const sequence=compileProject(project,assignSlots(project)).events;
assert.equal(sequence.filter(event=>event.velocity===100).length,4);
assert.equal(new Set(sequence.filter(event=>event.velocity===100).map(event=>event.frame)).size,1);
console.log('PASS loop seam, slope, ranking, pulse rejection, clipping, tail, ADSR and bounded MIDI scripts');
