// SPDX-License-Identifier: GPL-3.0-only
import {SamplerError, samplerPath, validSamplerId, validSamplerRef, validateInstrument} from './sampler-instrument.js';
import {directory, entries, maxMetadataBytes, notFound, physicalError, put, readMetadata, withFilesystemLock} from './sampler-filesystem.js';
import {inspect, inspectSample, prepareInstrument, publish, readLibrary, readSampleFile} from './sampler-library.js';
import {renderDerivative, runOffline} from './sampler-offline.js';
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
function operations(draft, through = draft.recipe.length, playbackRate = true) {
  const [start,end] = draft.selection;
  if (!Number.isInteger(through) || through < 0 || through > draft.recipe.length) fail('Choose a stage inside the processing stack.');
  const active = draft.recipe.slice(0,through).filter(op => !op.bypass).map(({bypass,...op}) => op);
  const recipe = [{type:'trim', start, end}, ...active];
  const rate = active.filter(op => op.type === 'rate').at(-1)?.sampleRate ?? draft.source.sampleRate;
  if (playbackRate && rate !== 44100) recipe.push({type:'rate',sampleRate:44100});
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
  if (draft.sliceMarkers !== undefined && (!Array.isArray(draft.sliceMarkers) ||
      draft.sliceMarkers.some((frame,i,marks) => !Number.isSafeInteger(frame) || frame <= (marks[i-1] ?? 0) || frame >= draft.source.frames))) {
    fail('Choose distinct slice markers in ascending order inside the source WAV.');
  }
  if (!Array.isArray(draft.selection) || draft.selection.length !== 2 ||
      !draft.selection.every(Number.isSafeInteger) || draft.selection[0] < 0 ||
      draft.selection[1] <= draft.selection[0] || draft.selection[1] > draft.source.frames) {
    fail('Choose a nonempty interval inside the original WAV.');
  }
  if (!Number.isInteger(draft.rootNote) || draft.rootNote < 0 || draft.rootNote > 127) fail('Choose a MIDI root from 0 through 127.');
  if (!Array.isArray(draft.recipe) || draft.recipe.some(op => !op || typeof op.type !== 'string' ||
      (op.bypass !== undefined && typeof op.bypass !== 'boolean'))) fail('Choose an ordered edit recipe.');
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
  if (draft.history && (!Array.isArray(draft.history.checkpoints) || !Array.isArray(draft.history.undo) ||
      !Array.isArray(draft.history.redo))) fail('This working copy has an invalid history.');
  return draft;
}

const changedFields = ['name','rootNote','selection','recipe','rendered','instrument','sliceMarkers'];
const historyOf = draft => draft.history ?? {checkpoints:[],undo:[],redo:[]};

// Keep only inverse changes. Audio, earlier actions and official revision
// pointers never become nested copies inside the undo stack.
function changesFrom(before, after) {
  const delta = {};
  for (const field of changedFields) if (!same(before[field],after[field])) delta[field] = field === 'sliceMarkers' ? before[field] ?? [] : before[field];
  return delta;
}

function record(before, after) {
  const next = validate(after);
  const undo = changesFrom(before,next);
  if (!Object.keys(undo).length) return next;
  const history = historyOf(before);
  return {...next,history:{...history,undo:[...history.undo,structuredClone(undo)],redo:[]}};
}

function step(draft, from, to) {
  validate(draft);
  const history = historyOf(draft), delta = history[from].at(-1);
  if (!delta) return draft;
  for (const field of Object.keys(delta)) if (!changedFields.includes(field)) fail('The undo history contains an unknown field.');
  const next = {...draft,...structuredClone(delta)};
  return validate({...next, history:{...history,[from]:history[from].slice(0,-1),
    [to]:[...history[to],structuredClone(changesFrom(draft,next))]}});
}

export const undoWorking = draft => step(draft,'undo','redo');
export const redoWorking = draft => step(draft,'redo','undo');

export function createWorking({libraryId, source, name = source?.name, selection = [0,source?.frames], rootNote = 60,
  recipe = [], baseRef = null, instrument = null, rendered = null, sliceMarkers = []} = {}) {
  return validate(structuredClone({format, version:1, id:crypto.randomUUID(), generation:0, libraryId,
    instrumentId:baseRef?.instrumentId ?? instrument?.id ?? crypto.randomUUID(), name:name ?? 'Untitled sample',
    source, selection, rootNote, recipe, instrument, rendered, baseRef, sliceMarkers}));
}

export function updateWorking(draft, changes) {
  validate(draft);
  for (const field of Object.keys(changes)) {
    if (!['name','selection','recipe','rootNote','instrument','baseRef','sliceMarkers'].includes(field)) fail('Unknown working copy field: ' + field);
  }
  const next = {...draft, ...structuredClone(changes)};
  if (!same(operations(next), operations(draft))) {
    if (next.instrument) fail('Create a sample working copy to edit audio used by a mapped instrument.');
    next.rendered = null;
  }
  return record(draft,next);
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

async function commitWorking(root, value, beforeWrite) {
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
      if (beforeWrite) await beforeWrite(folder);
      await put(folder,fileName(draft.id),payload);
      return next;
    });
  } catch (cause) {
    throw physicalError(cause, folderName);
  }
}

export const saveWorking = (root, draft) => commitWorking(root,draft);

export async function renderWorking(root, value, options = {}) {
  const draft = validate(structuredClone(value));
  await checkLibrary(root,draft);
  if (draft.instrument) fail('Choose an individual WAV to render.');
  const path = 'Samples/Processed/' + draft.id + '/' + crypto.randomUUID() + '.wav';
  const {sample} = await renderDerivative(root,draft.source,operations(draft),path,options);
  return record(draft,{...draft, rendered:sample});
}

export async function previewWorkingWav(root, draft, {through, signal, run = runOffline} = {}) {
  validate(draft);
  await checkLibrary(root,draft);
  // An explicitly selected stage retains its actual rate for measurements.
  const recipe = operations(draft,through,through === undefined);
  if (draft.rendered && same(draft.rendered.recipe.operations,recipe)) {
    return readSampleFile(root,draft.rendered,{signal});
  }
  const source = await readSampleFile(root,draft.source,{signal,maxFileBytes:128*1024*1024});
  return (await run(source,{type:'edit',recipe},{signal})).wav;
}

function playableSample(draft) {
  if (draft.rendered) return draft.rendered;
  if (draft.recipe.every(op => op.bypass) && draft.selection[0] === 0 && draft.selection[1] === draft.source.frames &&
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

const checkpointFormat = 'waswan-sampler-checkpoint';

export async function createCheckpoint(root, value, name) {
  const draft = validate(structuredClone(value));
  if (typeof name !== 'string' || !name.trim() || name.length > 256) fail('Name this checkpoint (up to 256 characters).');
  const link = {id:crypto.randomUUID(), workingId:draft.id, name:name.trim(), createdAt:new Date().toISOString()};
  const {history, ...snapshot} = draft;
  const document = {format:checkpointFormat,version:1,link,snapshot};
  const payload = JSON.stringify(document,null,2) + '\n';
  if (new Blob([payload]).size > maxMetadataBytes) fail('This checkpoint exceeds the metadata limit.');
  const previous = historyOf(draft);
  return commitWorking(root,{...draft,history:{...previous,checkpoints:[...previous.checkpoints,link]}},async folder => {
    const checkpoints = await directory(folder,['Checkpoints',draft.id],true);
    // UUID is newly generated; refuse to replace any existing checkpoint.
    if (await readMetadata(checkpoints,fileName(link.id))) fail('This checkpoint already exists.', 'working-conflict');
    await put(checkpoints,fileName(link.id),payload);
  });
}

export async function checkpointWorking(root, draft, id) {
  validate(draft);
  await checkLibrary(root,draft);
  const link = historyOf(draft).checkpoints.find(item => item.id === id);
  if (!link || !validSamplerId(link.workingId) || !validSamplerId(id)) fail('Choose a checkpoint from this working copy.');
  try {
    const folder = await directory(root,[folderName,'Checkpoints',link.workingId]);
    const entry = (await readMetadata(folder,fileName(id)))?.value;
    if (!entry || entry.format !== checkpointFormat || entry.version !== 1 || !same(entry.link,link) ||
        entry.snapshot?.id !== link.workingId || entry.snapshot?.libraryId !== draft.libraryId) {
      fail('The checkpoint identity differs from its history entry.', 'invalid-checkpoint');
    }
    return validate(entry.snapshot);
  } catch (cause) {
    throw physicalError(cause,folderName + '/Checkpoints/' + link.workingId + '/' + id + '.json');
  }
}

async function forkCheckpoint(root, draft, id, action, name) {
  const snapshot = await checkpointWorking(root,draft,id);
  const link = historyOf(draft).checkpoints.find(item => item.id === id);
  const baseRef = draft.baseRef;
  const instrumentId = baseRef?.instrumentId ?? crypto.randomUUID();
  const instrument = snapshot.instrument && {...snapshot.instrument,id:instrumentId};
  return validate({...snapshot, name:name ?? snapshot.name, id:crypto.randomUUID(), generation:0,
    baseRef, instrumentId, instrument, lineage:{action,workingId:link.workingId,checkpointId:id},
    history:{undo:[],redo:[],checkpoints:[...historyOf(draft).checkpoints]}});
}

export const restoreCheckpoint = (root,draft,id) => forkCheckpoint(root,draft,id,'restore');
export const branchWorking = (root,draft,id,name) => forkCheckpoint(root,draft,id,'branch',name);

export function continueFromRendered(draft) {
  validate(draft);
  if (!draft.rendered) fail('Render the current working copy before editing its result.', 'render-required');
  const fresh = createWorking({libraryId:draft.libraryId,source:draft.rendered,name:draft.name,
    rootNote:draft.rootNote,baseRef:draft.baseRef});
  return {...fresh, instrumentId:draft.instrumentId, lineage:{action:'render',workingId:draft.id,sampleId:draft.rendered.id},
    history:{undo:[],redo:[],checkpoints:[...historyOf(draft).checkpoints]}};
}

export async function startFromOriginal(root, draft) {
  validate(draft);
  await checkLibrary(root,draft);
  const seen = new Set();
  let source = draft.source;
  while (source.source) {
    if (seen.has(source.path)) fail('The sample contains a circular source reference.', 'cyclic-source');
    seen.add(source.path);
    const parent = source.source;
    source = await inspectSample(root,parent.path);
    if (source.sha256 !== parent.sha256) fail('The source WAV differs from the recorded original.', 'digest-mismatch');
  }
  const fresh = createWorking({libraryId:draft.libraryId,source,name:source.name ?? draft.name,baseRef:draft.baseRef});
  return {...fresh,lineage:{action:'original',workingId:draft.id}};
}

export async function discardWorking(root, draft) {
  validate(draft);
  await checkLibrary(root,draft);
  const fresh = draft.baseRef
    ? await workingFromRef(root,(await inspect(root,draft.baseRef,{latest:true})).ref)
    : await startFromOriginal(root,draft);
  // Checkpoints live outside the working pointer. Keep links when replacing it
  // so a discarded copy's history remains browsable after a process restart.
  return commitWorking(root,{...fresh, id:draft.id, generation:draft.generation, instrumentId:draft.instrumentId,
    lineage:draft.lineage ?? null, history:{checkpoints:historyOf(draft).checkpoints,undo:[],redo:[]}});
}

export async function repromoteWorking(root, draft, revision, options = {}) {
  validate(draft);
  const observed = draft.baseRef;
  if (!observed || !Number.isSafeInteger(revision) || revision < 1 || revision >= observed.revision) {
    fail('Choose a published revision older than the observed official revision.');
  }
  const current = (await inspect(root,observed,{latest:true})).ref;
  if (current.revision !== observed.revision) {
    throw new SamplerError('revision-conflict','The official revision changed. Reopen it before promoting.',
      {expectedRevision:observed.revision,actualRevision:current.revision,path:current.path});
  }
  const previous = await workingFromRef(root,{...current,revision});
  return promoteWorking(root,{...previous,baseRef:current},{...options,path:current.path});
}
