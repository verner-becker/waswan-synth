// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compile,createInstrument,explainNote,samplerLimits} from '../../web/sampler-instrument.js';
import {decodeWav,inspectWav} from '../../web/sampler-wav.js';
import {mapCaptureTakes,planCapture,runCapturePlan} from '../../web/sampler-capture.js';

function wave(plan, take) {
  const frames = plan.noteFrames + plan.releaseFrames;
  const bytes = Buffer.alloc(44 + frames * plan.channels * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(plan.channels, 22);
  bytes.writeUInt32LE(plan.sampleRate, 24);
  bytes.writeUInt32LE(plan.sampleRate * plan.channels * 2, 28);
  bytes.writeUInt16LE(plan.channels * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  bytes.writeInt16LE(1000 + take.note, 44);
  if (plan.releaseFrames) bytes.writeInt16LE(-1000 - take.velocity, 44 + plan.noteFrames * plan.channels * 2);
  bytes.writeInt16LE(take.repeat * 100, bytes.length - 2);
  return bytes;
}

function fakeIo(wait = (advance, deadline) => advance(deadline)) {
  let time = 0, current;
  const events = [];
  const clock = {now:() => time,waitUntil:deadline => wait(value => { time = value; }, deadline)};
  const output = {send(bytes) {
    assert(current, 'Audio capture should already be ready');
    events.push([time,...bytes]);
  }};
  const input = {async start(take, plan) {
    assert.equal(current, undefined, 'Previous take still holds its input');
    current = take.id;
    events.push([time,'start',current]);
    return {
      async finish() {
        events.push([time,'finish',current]);
        current = undefined;
        return wave(plan,take);
      },
      async abort() { events.push([time,'abort',current]); current = undefined; },
    };
  }};
  return {clock,output,input,events};
}

const settings = {notes:[67,60],velocities:[108,35],duration:.012,release:.005,repeats:2,midiChannel:3};
assert.throws(() => planCapture({...settings,notes:[60,60]}), {code:'invalid-capture-plan',field:'notes'});
assert.throws(() => planCapture({...settings,velocities:[0]}), {code:'invalid-capture-plan',field:'velocities'});
assert.throws(() => planCapture({...settings,duration:0}), {code:'invalid-capture-plan',field:'duration'});
assert.throws(() => planCapture({...settings,destination:'Samples/../Escape'}), {code:'invalid-path'});
assert.throws(() => planCapture({...settings,repeats:100}), {code:'invalid-capture-plan',field:'repeats'});

const plan = planCapture(settings);
assert.deepEqual(plan, planCapture({...settings,notes:[60,67],velocities:[35,108]}));
assert.equal(plan.takes.length, 8);
assert.equal(new Set(plan.takes.map(t => t.path)).size, 8);
assert.equal(plan.noteFrames, 529);
assert.equal(plan.releaseFrames, 221);
assert.equal(plan.totalFrames, 6000);
assert.equal(plan.estimatedBytes, 24352);
assert.deepEqual(plan.takes[0].key, [0,63]);
assert.deepEqual(plan.takes[0].velocityRange, [1,71]);
assert.deepEqual(plan.takes.at(-1).key, [64,127]);
assert.deepEqual(plan.takes.at(-1).velocityRange, [72,127]);
for (const [index,take] of plan.takes.entries()) {
  assert.equal(take.noteOffFrame - take.noteOnFrame, 529);
  assert.equal(take.endFrame - take.noteOffFrame, 221);
  assert.equal(take.endFrame, (index + 1) * 750);
}
await assert.rejects(runCapturePlan(plan), {code:'capture-unavailable'});

const io = fakeIo();
const descriptors = new Map();
const finished = await runCapturePlan(plan, {...io,async onTake(take,wav) {
  const meta = await inspectWav(wav);
  const decoded = await decodeWav(wav);
  assert.equal(meta.frames, 750);
  assert.equal(meta.channels, 2);
  assert.equal(decoded.pcm[0], 1000 + take.note);
  assert.equal(decoded.pcm[plan.noteFrames * plan.channels], -1000 - take.velocity);
  assert.equal(decoded.pcm.at(-1), 100 * take.repeat);
  const sha256 = createHash('sha256').update(wav).digest('hex');
  const sample = {...meta,sha256,id:take.id,path:take.path};
  descriptors.set(take.id, sample);
  return sha256;
}});
assert.equal(finished.length, 8);
assert.equal(io.events.length, 32);
for (const [index,take] of plan.takes.entries()) {
  const [start,on,off,end] = io.events.slice(index * 4, index * 4 + 4);
  assert.deepEqual(start.slice(1), ['start',take.id]);
  assert.deepEqual(on.slice(1), [0x93,take.note,take.velocity]);
  assert.deepEqual(off.slice(1), [0x83,take.note,0]);
  assert.deepEqual(end.slice(1), ['finish',take.id]);
  assert(Math.abs(on[0] * 44.1 - take.noteOnFrame) < .000001);
  assert(Math.abs(off[0] * 44.1 - take.noteOffFrame) < .000001);
  assert(Math.abs(end[0] * 44.1 - take.endFrame) < .000001);
}
const mapped = mapCaptureTakes(plan, descriptors);
assert.deepEqual(mapped.diagnostics, []);
assert.deepEqual(mapped.missing, []);
assert.equal(mapped.variations.length, 4);
const playing = compile(createInstrument({name:'Captured instrument',...mapped}));
let gesture = explainNote(playing,{type:'noteOn',note:60,velocity:35,id:'a'});
assert.equal(gesture.voices[0].sampleId, plan.takes[0].id);
gesture = explainNote(playing,{type:'noteOn',note:67,velocity:35,id:'b'},gesture.state);
assert.equal(gesture.voices[0].sampleId, plan.takes[4].id);
gesture = explainNote(playing,{type:'noteOn',note:60,velocity:35,id:'c'},gesture.state);
assert.equal(gesture.voices[0].sampleId, plan.takes[1].id);
for (const take of plan.takes.slice(-2)) descriptors.delete(take.id);
const incomplete = mapCaptureTakes(plan, descriptors);
assert.deepEqual(incomplete.missing, plan.takes.slice(-2).map(t => t.id));
const partial = compile(createInstrument({...incomplete}));
assert.equal(explainNote(partial,{type:'noteOn',note:67,velocity:108}).voices.length, 0);

// The dry plan still describes large arrangements. Sharing counters is explicit.
const large = planCapture({...settings,notes:Array.from({length:12}, (_, i) => 48 + i),velocities:[30,75,115]});
assert.equal(large.takes.length, 72);
const all = new Map(large.takes.map(take => [take.id,{...descriptors.values().next().value,id:take.id,path:take.path}]));
const independent = mapCaptureTakes(large, all);
assert.equal(independent.variations.length, 36);
assert.deepEqual(independent.diagnostics, [{code:'budget-exceeded',field:'variations',used:36,limit:samplerLimits.variations}]);
const shared = mapCaptureTakes(large, all, {variationScope:'velocity'});
assert.equal(shared.variations.length, 3);
assert.deepEqual(shared.diagnostics, []);
assert.equal(compile(createInstrument(shared)).instrument.regions.length, 72);

// Abort with a clock that deliberately ignores AbortSignal.
const early = new AbortController();
early.abort();
const untouched = fakeIo();
await assert.rejects(runCapturePlan(plan,{...untouched,signal:early.signal}), {code:'cancelled',completed:[]});
assert.deepEqual(untouched.events, []);
for (const interruptedWait of [3,4]) {
  const controller = new AbortController();
  let waits = 0;
  const interrupted = fakeIo((advance,deadline) => {
    if (++waits !== interruptedWait) return advance(deadline);
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  });
  let completed;
  await assert.rejects(runCapturePlan(plan,{...interrupted,signal:controller.signal}), error => {
    assert.equal(error.code, 'cancelled');
    completed = error.completed;
    return true;
  });
  assert.deepEqual(completed.map(record => record.take.id), [plan.takes[0].id]);
  assert.deepEqual(interrupted.events.slice(-4).map(event => event.slice(1)), [
    ['start',plan.takes[1].id],[0x93,60,35],[0x83,60,0],['abort',plan.takes[1].id]
  ]);
  const resumed = await runCapturePlan(plan,{...fakeIo(),fromTake:completed.length});
  assert.deepEqual(resumed.map(record => record.take.id), plan.takes.slice(1).map(take => take.id));
}

const badClock = fakeIo(() => { throw Error('Clock failed'); });
await assert.rejects(runCapturePlan(plan,badClock), error => error.code === 'capture-failed' && error.cause.message === 'Clock failed');
assert.deepEqual(badClock.events.slice(-2).map(event => event.slice(1)), [[0x83,60,0],['abort',plan.takes[0].id]]);
console.log('PASS deterministic capture plan, independent and shared mapping, simulated attack/release WAV, cancellation, resume');
