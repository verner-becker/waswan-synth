// SPDX-License-Identifier: GPL-3.0-only
import {SamplerError, samplerPath, validSamplerId, validSamplerRef, validateInstrument} from './sampler-instrument.js';
import {directory, entries, maxMetadataBytes, notFound, physicalError, put, readMetadata, withFilesystemLock} from './sampler-filesystem.js';
import {inspect, inspectSample, prepareInstrument, publish, readLibrary, readSampleFile} from './sampler-library.js';
import {renderDerivative} from './sampler-offline.js';
import {mapSample, stageWorkingSampler} from './sampler.js';

const format = 'waswan-sampler-working';
const folderName = 'Drafts';
const fail = (message, code = 'invalid-working') => { throw new SamplerError(code, message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function checkSample(sample) {
  if (!validSamplerId(sample?.id) || !/^[a-f0-9]{64}$/.test(sample.sha256) ||
      ![44100,48000].includes(sample.sampleRate) || ![1,2].includes(sample.channels) ||
      !Number.isSafeInteger(sample.frames) || sample.frames < 1 || !/\.wav$/iu.test(sample.path)) {
    fail('Choose a library WAV with a known identity and frame count.');
  }
  samplerPath(sample.path);
}

// Source coordinates belong to the input WAV. Rendered PCM starts at frame 0.
function operations(draft) {
  const [start,end] = draft.selection;
  const recipe = [{type:'trim', start, end}, ...draft.recipe];
  const rate = draft.recipe.filter(op => op.type === 'rate').at(-1)?.sampleRate ?? draft.source.sampleRate;
  if (rate !== 44100) recipe.push({type:'rate',sampleRate:44100});
  if (recipe.length > 128) fail('Use up to 128 operations including the source selection and playback rate conversion.');
  return recipe;
}

function validate(draft) {
  if (draft?.format !== format || draft.version !== 1) fail('This working copy version is unavailable.', 'unsupported-feature');
  if (![draft.id,draft.libraryId,draft.instrumentId].every(validSamplerId) ||
      !Number.isSafeInteger(draft.generation) || draft.generation < 0 ||
      typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 256) {
    fail('The working copy needs a name and valid identities.');
  }
  checkSample(draft.source);
  if (!Array.isArray(draft.selection) || draft.selection.length !== 2 ||
      !draft.selection.every(Number.isSafeInteger) || draft.selection[0] < 0 ||
      draft.selection[1] <= draft.selection[0] || draft.selection[1] > draft.source.frames) {
    fail('Choose a nonempty interval inside the original WAV.');
  }
  if (!Number.isInteger(draft.rootNote) || draft.rootNote < 0 || draft.rootNote > 127) fail('Choose a MIDI root from 0 through 127.');
  if (!Array.isArray(draft.recipe) || draft.recipe.some(op => !op || typeof op.type !== 'string')) fail('Choose an ordered edit recipe.');
  const recipe = operations(draft);
  if (draft.baseRef && (!validSamplerRef(draft.baseRef) || draft.baseRef.libraryId !== draft.libraryId ||
      draft.baseRef.instrumentId !== draft.instrumentId)) fail('The official reference belongs to a different instrument.');
  if (draft.rendered) {
    checkSample(draft.rendered);
    if (draft.rendered.source?.sha256 !== draft.source.sha256 || draft.rendered.source?.path !== draft.source.path ||
        draft.rendered.recipe?.version !== 1 || !same(draft.rendered.recipe.operations, recipe)) {
      fail('Render the current selection and processing stack again.', 'render-required');
    }
  }
  if (draft.instrument && validateInstrument(draft.instrument).id !== draft.instrumentId) fail('The map belongs to another instrument.');
  return draft;
}

export function createWorking({libraryId, source, name = source?.name, selection = [0,source?.frames], rootNote = 60,
  recipe = [], baseRef = null, instrument = null, rendered = null} = {}) {
  return validate(structuredClone({format, version:1, id:crypto.randomUUID(), generation:0, libraryId,
    instrumentId:baseRef?.instrumentId ?? instrument?.id ?? crypto.randomUUID(), name:name ?? 'Untitled sample',
    source, selection, rootNote, recipe, instrument, rendered, baseRef}));
}

export function updateWorking(draft, changes) {
  validate(draft);
  for (const field of Object.keys(changes)) {
    if (!['name','selection','recipe','rootNote','instrument','baseRef'].includes(field)) fail('Unknown working copy field: ' + field);
  }
  const next = structuredClone({...draft, ...changes});
  if (!same(next.selection,draft.selection) || !same(next.recipe,draft.recipe)) {
    if (next.instrument) fail('Create a sample working copy to edit audio used by a mapped instrument.');
    next.rendered = null;
  }
  return validate(next);
}

async function checkLibrary(root, draft) {
  const library = await readLibrary(root);
  if (library.id !== draft.libraryId) fail('Choose the library containing this working copy.', 'library-mismatch');
}

function fileName(id) {
  if (!validSamplerId(id)) fail('Invalid working copy identifier.');
  return id + '.json';
}

async function readDraft(folder, id, libraryId) {
  const stored = await readMetadata(folder, fileName(id), {empty:true});
  if (!stored) return null;
  const draft = validate(stored.value);
  if (draft.id !== id || draft.libraryId !== libraryId || draft.generation < 1) fail('The saved working copy identity differs from its file.');
  return draft;
}

export async function openWorking(root, id) {
  const library = await readLibrary(root);
  try {
    const draft = await readDraft(await directory(root,[folderName]), id, library.id);
    if (!draft) fail('This working copy is missing.', 'missing-working');
    return draft;
  } catch (cause) {
    if (notFound(cause)) fail('This working copy is missing.', 'missing-working');
    throw physicalError(cause, folderName);
  }
}

export async function listWorking(root) {
  const library = await readLibrary(root);
  let folder;
  try {
    folder = await directory(root,[folderName]);
  } catch (cause) {
    if (notFound(cause)) return [];
    throw physicalError(cause, folderName);
  }
  const items = [];
  for await (const [name,handle] of entries(folder)) {
    const id = name.slice(0,-5);
    if (handle.kind !== 'file' || !name.endsWith('.json') || !validSamplerId(id)) continue;
    try {
      const draft = await readDraft(folder,id,library.id);
      if (draft) items.push({id, name:draft.name, generation:draft.generation});
    } catch (cause) {
      const issue = physicalError(cause, folderName + '/' + name);
      if (issue.code === 'permission-required') throw issue;
      items.push({id,name,diagnostic:{code:issue.code,message:issue.message}});
    }
  }
  return items.sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function saveWorking(root, value) {
  const draft = validate(structuredClone(value));
  await checkLibrary(root,draft);
  try {
    return await withFilesystemLock('waswan-sampler-working:' + draft.libraryId + ':' + draft.id, async () => {
      const folder = await directory(root,[folderName],true);
      const saved = await readDraft(folder,draft.id,draft.libraryId);
      if ((saved?.generation ?? 0) !== draft.generation) fail('The saved working copy changed. Reopen it before saving.', 'working-conflict');
      const next = {...draft, generation:draft.generation + 1};
      const payload = JSON.stringify(next,null,2) + '\n';
      if (new Blob([payload]).size > maxMetadataBytes) fail('This working copy exceeds the metadata limit.');
      await put(folder,fileName(draft.id),payload);
      return next;
    });
  } catch (cause) {
    throw physicalError(cause, folderName);
  }
}

export async function renderWorking(root, value, options = {}) {
  const draft = validate(structuredClone(value));
  await checkLibrary(root,draft);
  if (draft.instrument) fail('Choose an individual WAV to render.');
  const path = 'Samples/Processed/' + draft.id + '/' + crypto.randomUUID() + '.wav';
  const {sample} = await renderDerivative(root,draft.source,operations(draft),path,options);
  return validate({...draft, rendered:sample});
}

function playableSample(draft) {
  if (draft.rendered) return draft.rendered;
  if (!draft.recipe.length && draft.selection[0] === 0 && draft.selection[1] === draft.source.frames &&
      draft.source.sampleRate === 44100) return draft.source;
  fail('Render this selection and processing stack before preparing it.', 'render-required');
}

export function workingInstrument(value) {
  const draft = validate(value);
  if (draft.instrument) return validateInstrument({...structuredClone(draft.instrument),name:draft.name});
  const sample = playableSample(draft);
  return {...mapSample(sample,draft.rootNote,{name:draft.name}), id:draft.instrumentId,
    workingSource:{version:1, selection:draft.selection, recipe:draft.recipe,
      renderedId:draft.rendered?.id ?? null}};
}

export async function prepareWorking(player, root, draft, options = {}) {
  await checkLibrary(root,draft);
  const prepared = await prepareInstrument(root,workingInstrument(draft),options);
  return stageWorkingSampler(player,prepared,options);
}

export async function promoteWorking(root, value, {path = value.baseRef?.path, player, signal, onProgress} = {}) {
  const draft = validate(structuredClone(value));
  await checkLibrary(root,draft);
  if (!player?.requests) fail('Start audio to check this instrument in the shared host before promoting.', 'audio-required');
  const instrument = workingInstrument(draft);
  // An edited official carries the source identity as well as the playable WAV.
  if (draft.rendered) await readSampleFile(root,draft.source,{signal});
  const prepared = await prepareInstrument(root,instrument,{signal,onProgress});
  await stageWorkingSampler(player,prepared,{signal,checkOnly:true});
  signal?.throwIfAborted();
  return publish(root,instrument,{path,expectedRevision:draft.baseRef?.revision ?? 0});
}

export async function workingFromRef(root, requested) {
  const {instrument,ref} = await inspect(root,requested);
  const source = instrument.samples.find(s => s.id === instrument.regions[0]?.sample);
  if (!source) fail('This instrument has no sample to open.');
  const {workingSource:saved, ...map} = instrument;
  if (saved?.version === 1 && map.regions.length === 1 && map.samples.length === 1) {
    const rootNote = map.regions[0].root;
    const basic = {...mapSample(source,rootNote,{name:map.name}), id:map.id, revision:map.revision};
    // A preset or another editor can extend this map. Preserve those changes.
    if (same(basic,map)) {
      const rendered = saved.renderedId ? source : null;
      if (rendered && saved.renderedId !== rendered.id) fail('This revision references a different render.');
      const original = rendered ? await inspectSample(root,rendered.source.path) : source;
      return createWorking({libraryId:ref.libraryId, source:original, name:map.name, baseRef:ref,
        selection:saved.selection, recipe:saved.recipe, rootNote, rendered});
    }
  }
  return createWorking({libraryId:ref.libraryId, source, name:instrument.name, baseRef:ref, instrument,
    rootNote:instrument.regions[0].root});
}
