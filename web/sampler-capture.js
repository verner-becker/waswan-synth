// SPDX-License-Identifier: GPL-3.0-only
import {SamplerError,samplerLimits,samplerPath} from './sampler-instrument.js';

function requireCapture(condition, message, field) {
  if (!condition) throw new SamplerError('invalid-capture-plan', message, {field});
}

function midiValues(values, minimum, field) {
  requireCapture(Array.isArray(values) && values.length > 0 && values.length <= 128 &&
    values.every(value => Number.isInteger(value) && value >= minimum && value <= 127) &&
    new Set(values).size === values.length, 'Choose distinct MIDI values.', field);
  return [...values].sort((a,b) => a - b);
}

function zones(values, minimum, maximum) {
  return values.map((value,index) => [
    index ? Math.floor((values[index - 1] + value) / 2) + 1 : minimum,
    index + 1 < values.length ? Math.floor((value + values[index + 1]) / 2) : maximum,
  ]);
}

const label = (number, digits) => String(number).padStart(digits, '0');

export function planCapture({notes,velocities,duration,release,repeats = 1,sampleRate = 44100,
  channels = 2,midiChannel = 0,destination = 'Samples/Originals/Auto capture'} = {}) {
  const roots = midiValues(notes, 0, 'notes');
  const dynamics = midiValues(velocities, 1, 'velocities');
  requireCapture(Number.isSafeInteger(repeats) && repeats > 0 && roots.length * dynamics.length * repeats <= samplerLimits.regions,
    'The plan must fit the number of regions in one sampler instrument.', 'repeats');
  requireCapture([44100,48000].includes(sampleRate), 'Choose a supported capture rate.', 'sampleRate');
  requireCapture([1,2].includes(channels), 'Choose mono or stereo.', 'channels');
  requireCapture(Number.isInteger(midiChannel) && midiChannel >= 0 && midiChannel <= 15,
    'Choose a MIDI channel from 0 through 15.', 'midiChannel');
  requireCapture(Number.isFinite(duration) && duration > 0, 'Choose a positive note length in seconds.', 'duration');
  requireCapture(Number.isFinite(release) && release >= 0, 'Choose a nonnegative release length in seconds.', 'release');
  const noteFrames = Math.round(duration * sampleRate);
  const releaseFrames = Math.round(release * sampleRate);
  const takeFrames = noteFrames + releaseFrames;
  requireCapture(noteFrames > 0 && takeFrames <= sampleRate * 1200, 'A take must last at least one frame and at most 20 minutes.', 'duration');
  const [samples,originals,...folder] = samplerPath(destination);
  requireCapture(samples === 'Samples' && originals === 'Originals' && folder.length > 0,
    'Choose a destination folder inside Samples/Originals.', 'destination');

  const keys = zones(roots, 0, 127);
  const dynamicsRanges = zones(dynamics, 1, 127);
  const takes = [];
  for (const [keyIndex,note] of roots.entries()) {
    for (const [velocityIndex,velocity] of dynamics.entries()) {
      const groupId = `n${label(note,3)}-v${label(velocity,3)}`;
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const id = `${groupId}-t${label(repeat,3)}`;
        const noteOnFrame = takes.length * takeFrames;
        takes.push({id,groupId,note,velocity,repeat,path:`${destination}/${id}.wav`,key:keys[keyIndex],
          velocityRange:dynamicsRanges[velocityIndex],noteOnFrame,noteOffFrame:noteOnFrame + noteFrames,
          endFrame:noteOnFrame + takeFrames});
      }
    }
  }
  const totalFrames = takeFrames * takes.length;
  return {sampleRate,channels,midiChannel,noteFrames,releaseFrames,totalFrames,
    estimatedBytes:totalFrames * channels * 2 + takes.length * 44,takes};
}

// Supply descriptors returned by the library import, keyed by planned take ID.
// Preserve the planned zones when some takes are unavailable.
export function mapCaptureTakes(plan, samplesByTakeId, {variationScope = 'note-and-velocity'} = {}) {
  requireCapture(['note-and-velocity','velocity'].includes(variationScope), 'Choose a supported variation scope.', 'variationScope');
  const samples = new Map();
  const variationMembers = new Map();
  const regions = [];
  const missing = [];
  for (const take of plan.takes) {
    const sample = samplesByTakeId.get(take.id);
    if (!sample) {
      missing.push(take.id);
      continue;
    }
    const previous = samples.get(sample.id);
    requireCapture(!previous || previous.sha256 === sample.sha256 && previous.path === sample.path,
      'Takes with the same sample identifier must point to the same original.', take.id);
    samples.set(sample.id, sample);
    const region = {id:take.id,group:'main',sample:sample.id,key:[...take.key],root:take.note,velocity:[...take.velocityRange],
      mode:'gate',trigger:'attack'};
    const setId = variationScope === 'velocity' ? `v${label(take.velocity,3)}` : take.groupId;
    if (!variationMembers.has(setId)) variationMembers.set(setId, []);
    variationMembers.get(setId).push({region,member:`t${label(take.repeat,3)}`});
    regions.push(region);
  }
  const variations = [];
  const diagnostics = [];
  for (const [id,members] of variationMembers) {
    const order = [...new Set(members.map(({member}) => member))].sort();
    if (order.length < 2) continue;
    variations.push({id,mode:'sequential',order});
    if (order.length > samplerLimits.variationMembers) {
      diagnostics.push({code:'budget-exceeded',field:`variations.${id}.order`,used:order.length,limit:samplerLimits.variationMembers});
    }
    for (const {region,member} of members) region.variation = {set:id,member};
  }
  if (variations.length > samplerLimits.variations) {
    diagnostics.push({code:'budget-exceeded',field:'variations',used:variations.length,limit:samplerLimits.variations});
  }
  return {samples:[...samples.values()],regions,variations,missing,diagnostics};
}

const realtimeClock = {
  now: () => performance.now(),
  waitUntil(deadline, signal) {
    signal?.throwIfAborted();
    const delay = Math.max(0, deadline - performance.now());
    if (!delay) return Promise.resolve();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, delay);
      function abort() {
        clearTimeout(timer);
        reject(signal.reason);
      }
      signal?.addEventListener('abort', abort, {once:true});
    });
  },
};

function waitForFrameTime(clock, deadline, signal) {
  signal?.throwIfAborted();
  if (!signal) return clock.waitUntil(deadline);
  let abort;
  const interrupted = new Promise((_,reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, {once:true});
  });
  return Promise.race([Promise.resolve().then(() => clock.waitUntil(deadline,signal)),interrupted])
    .finally(() => signal.removeEventListener('abort', abort));
}

async function captureTake(take, plan, output, input, clock, signal) {
  signal?.throwIfAborted();
  const capture = await input.start(take, plan, signal);
  let finished = false, failure;
  try {
    signal?.throwIfAborted();
    requireCapture(typeof capture?.finish === 'function' && typeof capture?.abort === 'function',
      'The capture input must supply finish and abort operations.', 'input');
    const millisecondsPerFrame = 1000 / plan.sampleRate;
    const onTime = clock.now();
    output.send([0x90 | plan.midiChannel,take.note,take.velocity]);
    try {
      await waitForFrameTime(clock, onTime + plan.noteFrames * millisecondsPerFrame, signal);
    } finally {
      output.send([0x80 | plan.midiChannel,take.note,0]);
    }
    await waitForFrameTime(clock, clock.now() + plan.releaseFrames * millisecondsPerFrame, signal);
    signal?.throwIfAborted();
    const source = await capture.finish(signal);
    signal?.throwIfAborted();
    requireCapture(source instanceof Blob || source instanceof ArrayBuffer || ArrayBuffer.isView(source),
      'The capture input must return WAV bytes.', 'input');
    finished = true;
    return source;
  } catch (cause) {
    failure = cause;
    throw cause;
  } finally {
    if (!finished) {
      try {
        await capture?.abort?.();
      } catch (cleanup) {
        throw failure ? new AggregateError([failure,cleanup], 'Capture and cleanup both failed.') : cleanup;
      }
    }
  }
}

// The caller supplies output and capture input. This module does not open
// devices. onTake may publish the result to disk and return a small receipt.
export async function runCapturePlan(plan,{output,input,clock = realtimeClock,signal,onTake,fromTake = 0} = {}) {
  if (typeof output?.send !== 'function' || typeof input?.start !== 'function' ||
      typeof clock?.now !== 'function' || typeof clock?.waitUntil !== 'function') {
    throw new SamplerError('capture-unavailable', 'Supply a MIDI output and audio capture input.');
  }
  requireCapture(Array.isArray(plan?.takes) && Number.isInteger(fromTake) && fromTake >= 0 && fromTake <= plan.takes.length,
    'Choose a valid starting take.', 'fromTake');
  const completed = [];
  try {
    signal?.throwIfAborted();
    for (const take of plan.takes.slice(fromTake)) {
      const source = await captureTake(take, plan, output, input, clock, signal);
      const result = onTake ? await onTake(take,source) : source;
      completed.push({take,result});
    }
    return completed;
  } catch (cause) {
    if (signal?.aborted) throw new SamplerError('cancelled', 'Capture cancelled.', {cause,completed});
    throw new SamplerError('capture-failed', 'Capture stopped before the next take could finish.', {cause,completed});
  }
}
