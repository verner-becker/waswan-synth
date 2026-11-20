// SPDX-License-Identifier: GPL-3.0-only
// Control-side bridge from a physical library to the single WASM instrument.
import {prepare} from './sampler-library.js';
import {packSampler} from './sampler-runtime.js';
import {createInstrument} from './sampler-instrument.js';
import {decodeWav, inspectWav} from './sampler-wav.js';
import {librarySetting} from './tone-bank.js';

// A single WAV and a multisample instrument use exactly the same region model.
export function mapSample(sample, rootNote, {name=sample.id, mode='gate'}={}) {
  return createInstrument({name, samples:[sample],
    regions:[{id:'region', group:'main', sample:sample.id, root:rootNote, mode}]});
}

async function upload(player, ref, instrument, samples, signal) {
  const rpc = player.requests();
  const {patch} = await rpc.request('daw-sampler-patch');
  signal?.throwIfAborted();
  const {token, sampleIds} = await rpc.request('daw-sampler-begin', {ref, packed:packSampler(instrument)});
  try {
    for (const sampleId of sampleIds) {
      const source = samples.get(sampleId);
      for (let offset = 0; offset < source.length; offset += 32768) {
        signal?.throwIfAborted();
        const pcm = source.slice(offset, offset + 32768);
        await rpc.request('daw-sampler-chunk', {token, sampleId, offset, pcm}, [pcm.buffer]);
      }
    }
    signal?.throwIfAborted();
    await rpc.request('daw-sampler-commit', {token});
  } catch (error) {
    await rpc.request('daw-sampler-cancel', {token}).catch(() => {});
    throw error;
  }
  return {...ref, type:'sampler', patch};
}

export async function prepareSampler(player, root, ref, options = {}) {
  const prepared = await prepare(root, ref, options);
  return upload(player, prepared.ref, prepared.instrument, prepared.samples, options.signal);
}

// Audition an unpublished WAV on the live route. The transient reference is
// deliberately unsuitable for saving in a project: publish the mapped instrument first.
export async function prepareSamplePreview(player, file, rootNote=60, options={}) {
  const layout=await inspectWav(file);
  if(layout.frames*layout.channels*2>64*1024*1024 || file.size>68*1024*1024)throw Error('Preview exceeds the resident PCM budget');
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const sample={id:'preview',path:'Samples/Preview.wav',sha256:hash,...layout};
  const id='preview-'+hash+'-'+rootNote;
  const instrument={...mapSample(sample,rootNote,{mode:'oneShot'}),id,revision:1};
  const {pcm}=await decodeWav(file);
  return upload(player,{libraryId:'preview',instrumentId:id,revision:1},instrument,new Map([[sample.id,pcm]]),options.signal);
}

export async function setLiveSampler(player, ref) {
  await player.requests().request('daw-sampler-live', {ref});
}

export async function prepareProjectSamplers(player, project, options = {}) {
  const seen = new Set();
  let root;
  for (const {instrument} of project.tracks) {
    if (instrument?.type !== 'sampler') continue;
    const key = JSON.stringify([instrument.libraryId, instrument.instrumentId, instrument.revision]);
    if (seen.has(key)) continue;
    seen.add(key);
    const {resident} = await player.requests().request('daw-sampler-status', {ref:instrument});
    if (resident) continue;
    root ??= await librarySetting(undefined, 'sampleLibrary');
    if (!root) throw Error('Choose the Samples folder containing '+instrument.path);
    await prepareSampler(player, root, instrument, options);
  }
}
