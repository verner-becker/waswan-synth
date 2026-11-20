// SPDX-License-Identifier: GPL-3.0-only

import {SamplerError, compile, samplerLimits, samplerPath, validSamplerId, validSamplerRef, validateInstrument} from './sampler-instrument.js';
import {asBlob, decodePCM, inspectWav} from './sampler-wav.js';

export {decodeWav, inspectWav} from './sampler-wav.js';

const libraryFormat = 'waswan-sampler-library';
const rootFile = 'library.json';
const currentFile = 'instrument.json';
const instrumentBuckets = ['Instruments', 'Kits'];
const collections = [...instrumentBuckets, 'Samples', 'Presets'];
const maxMetadataBytes = 4 * 1024 * 1024;
const maxPlaybackFileBytes = samplerLimits.memoryBytes + 16 * 1024 * 1024;
const localLocks = new Map();

const error = (code, message, details) => new SamplerError(code, message, details);
const json = value => JSON.stringify(value, null, 2) + '\n';
const folded = value => value.normalize('NFC').toLowerCase();
const order = (a, b) => a < b ? -1 : Number(a > b);
const existsError = cause => cause?.name === 'NotFoundError';

function physicalError(cause, path) {
  if (cause instanceof SamplerError) return cause;
  const details = {path, cause};
  if (['NotAllowedError', 'SecurityError', 'EACCES', 'EPERM'].includes(cause?.name) ||
      ['EACCES', 'EPERM'].includes(cause?.code)) {
    return error('permission-required', 'Grant access to the sampler library folder again.', details);
  }
  if (existsError(cause)) return error('missing-path', 'This path is missing from the sampler library.', details);
  if (cause?.name === 'TypeMismatchError') return error('path-conflict', 'A file or folder already uses this name.', details);
  return error('filesystem-error', 'Unable to access the sampler library file.', details);
}

async function locked(id, run) {
  const name = 'waswan-sampler-library:' + id;
  if (globalThis.navigator?.locks) return globalThis.navigator.locks.request(name, run);
  const task = (localLocks.get(name) ?? Promise.resolve()).then(run);
  const tail = task.catch(() => {});
  localLocks.set(name, tail);
  try {
    return await task;
  } finally {
    if (localLocks.get(name) === tail) localLocks.delete(name);
  }
}

function checkAbort(signal) {
  if (signal?.aborted) throw error('cancelled', 'Sampler preparation was cancelled.');
}

async function* entries(directory) {
  if (typeof directory.entries === 'function') yield* directory.entries();
  else for await (const handle of directory.values()) yield [handle.name, handle];
}

async function ensureFreeSpelling(folder, name, path) {
  for await (const [actual] of entries(folder)) {
    if (actual !== name && folded(actual) === folded(name)) {
      throw error('path-conflict', 'This folder already contains a name that differs only in spelling or case.', {path, actual});
    }
  }
}

async function directory(root, segments, create = false) {
  let folder = root;
  for (const name of segments) {
    if (create) await ensureFreeSpelling(folder, name, segments.join('/'));
    folder = await folder.getDirectoryHandle(name, {create});
  }
  return folder;
}

async function fileAt(root, path) {
  const segments = samplerPath(path);
  const name = segments.pop();
  return (await directory(root, segments)).getFileHandle(name);
}

async function optionalFile(folder, name) {
  try {
    return await (await folder.getFileHandle(name)).getFile();
  } catch (cause) {
    if (existsError(cause)) return undefined;
    throw cause;
  }
}

async function readMetadata(folder, name, {empty = false} = {}) {
  const file = await optionalFile(folder, name);
  if (!file || (empty && !file.size)) return undefined;
  if (file.size > maxMetadataBytes) throw error('invalid-metadata', 'This sampler metadata file is too large.', {path: name});
  const raw = await file.text();
  try {
    return {raw, value: JSON.parse(raw)};
  } catch (cause) {
    throw error('invalid-metadata', 'This sampler metadata file cannot be read as JSON.', {path: name, cause});
  }
}

async function put(folder, name, payload) {
  await ensureFreeSpelling(folder, name, name);
  const handle = await folder.getFileHandle(name, {create: true});
  const writer = await handle.createWritable();
  try {
    await writer.write(payload);
    await writer.close();
  } catch (cause) {
    await writer.abort().catch(() => {});
    throw cause;
  }
}

function rootDocument({id = globalThis.crypto.randomUUID(), name = 'Sampler library'} = {}) {
  if (!validSamplerId(id) || typeof name !== 'string' || !name.trim() || name.length > 256) {
    throw error('invalid-metadata', 'The library needs a name and a valid identifier.', {path: rootFile});
  }
  return {format: libraryFormat, version: 1, id, name};
}

export async function readLibrary(root) {
  try {
    const document = (await readMetadata(root, rootFile))?.value;
    if (!document) throw error('missing-library', 'Select a folder with a sampler library.', {path: rootFile});
    if (document.format !== libraryFormat || document.version !== 1) {
      throw error('unsupported-feature', 'This sampler library version is unavailable.', {path: rootFile});
    }
    if (!validSamplerId(document.id) || typeof document.name !== 'string') {
      throw error('invalid-metadata', 'The library is missing its identity or name.', {path: rootFile});
    }
    return rootDocument(document);
  } catch (cause) {
    throw physicalError(cause, rootFile);
  }
}

export async function initializeLibrary(root, options = {}) {
  return locked('initialize', async () => {
    try {
      const existing = await readMetadata(root, rootFile, {empty: true});
      if (existing) {
        const library = await readLibrary(root);
        if (options.id !== undefined && options.id !== library.id) {
          throw error('library-mismatch', 'This folder already contains a different sampler library.', {path: rootFile});
        }
        return library;
      }
      const library = rootDocument(options);
      for (const segments of [['Instruments'], ['Kits'], ['Samples', 'Originals'], ['Samples', 'Processed'], ['Presets']]) {
        await directory(root, segments, true);
      }
      await put(root, rootFile, json(library));
      return library;
    } catch (cause) {
      throw physicalError(cause, rootFile);
    }
  });
}

async function digest(bytes) {
  const result = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(result, byte => byte.toString(16).padStart(2, '0')).join('');
}

function originalPath(path) {
  const segments = samplerPath(path);
  if (segments.length < 3 || segments[0] !== 'Samples' || !['Originals', 'Processed'].includes(segments[1]) ||
      !/\.wav$/iu.test(segments.at(-1))) {
    throw error('invalid-path', 'Choose a WAV path under Samples/Originals or Samples/Processed.', {path});
  }
  return segments;
}

async function copySample(root, file, path, sha256) {
  const segments = originalPath(path);
  const name = segments.pop();
  const folder = await directory(root, segments, true);
  await ensureFreeSpelling(folder, name, path);
  const current = await optionalFile(folder, name);
  if (current) {
    if (current.size !== file.size || await digest(await current.arrayBuffer()) !== sha256) {
      throw error('path-conflict', 'A different file already uses this WAV path.', {path});
    }
  } else {
    try {
      await put(folder, name, file);
    } catch (cause) {
      const orphan = await optionalFile(folder, name).catch(() => undefined);
      if (orphan?.size === 0) await folder.removeEntry?.(name).catch(() => {});
      throw cause;
    }
  }
}

export async function importOriginal(root, source, path, options = {}) {
  const {id = globalThis.crypto.randomUUID(), provenance, license, recipe, source: sourceIdentity} = options;
  if (!validSamplerId(id)) throw error('invalid-sample', 'Choose a valid sample identifier.', {path});
  originalPath(path);
  try {
    const library = await readLibrary(root);
    const file = asBlob(source);
    const {frames, channels, sampleRate, size} = await inspectWav(file, {anyRate: true});
    if (![44100, 48000].includes(sampleRate)) {
      throw error('unsupported-feature', 'The library currently imports PCM16 at 44.1 or 48 kHz.', {path});
    }
    const sha256 = await digest(await file.arrayBuffer());
    await locked(library.id, () => copySample(root, file, path, sha256));
    const descriptor = {id, path, sha256, frames, channels, sampleRate, size};
    for (const [key, value] of Object.entries({provenance, license, recipe, source: sourceIdentity})) {
      if (value !== undefined) descriptor[key] = structuredClone(value);
    }
    return descriptor;
  } catch (cause) {
    throw physicalError(cause, path);
  }
}

function makeRef(library, instrument, path) {
  return {type: 'sampler', libraryId: library.id, instrumentId: instrument.id, revision: instrument.revision, path};
}

function instrumentPath(path, kind) {
  const segments = samplerPath(path);
  const folder = kind === 'kit' ? 'Kits' : 'Instruments';
  if (segments[0] !== folder || segments.length < 2 || segments.some(name => folded(name) === 'revisions')) {
    throw error('invalid-path', `Choose a named folder inside ${folder}.`, {path});
  }
  return segments;
}

function published(metadata, path) {
  const instrument = validateInstrument(metadata.value);
  instrumentPath(path, instrument.kind);
  if (!instrument.revision) throw error('invalid-metadata', 'A published instrument needs a positive revision.', {path});
  return instrument;
}

async function readCurrent(root, path) {
  let folder;
  try {
    folder = await directory(root, samplerPath(path));
  } catch (cause) {
    if (existsError(cause)) return undefined;
    throw cause;
  }
  const metadata = await readMetadata(folder, currentFile, {empty: true});
  if (!metadata) return undefined;
  return {folder, path, raw: metadata.raw, instrument: published(metadata, path)};
}

function safeChild(path, name) {
  const result = path ? path + '/' + name : name;
  try {
    samplerPath(result);
    return result;
  } catch {
    return undefined;
  }
}

async function* tree(root, path) {
  const pending = [[root, path]];
  while (pending.length) {
    const [folder, here] = pending.pop();
    for await (const [name, handle] of entries(folder)) {
      const child = safeChild(here, name);
      if (!child || hidden(name, here)) continue;
      if (!here && handle.kind === 'directory' && !collections.includes(name)) continue;
      yield {folder, name, handle, path: child};
      if (handle.kind === 'directory') pending.push([handle, child]);
    }
  }
}

async function locate(root, instrumentId, knownPath) {
  let directError;
  if (knownPath) {
    try {
      const candidate = await readCurrent(root, knownPath);
      if (candidate?.instrument.id === instrumentId) return candidate;
    } catch (cause) {
      if (!['invalid-metadata', 'invalid-instrument', 'unsupported-feature'].includes(cause?.code)) throw cause;
      directError = cause;
    }
  }
  let found;
  for (const bucket of instrumentBuckets) {
    let folder;
    try {
      folder = await root.getDirectoryHandle(bucket);
    } catch (cause) {
      if (existsError(cause)) continue;
      throw cause;
    }
    for await (const {folder: parent, path, name, handle} of tree(folder, bucket)) {
      if (handle.kind !== 'file' || name !== currentFile || path === bucket + '/' + currentFile) continue;
      const location = path.slice(0, -currentFile.length - 1);
      let metadata;
      try {
        metadata = await readMetadata(parent, name, {empty: true});
      } catch (cause) {
        if (cause?.code === 'invalid-metadata') continue;
        throw cause;
      }
      if (metadata?.value?.id !== instrumentId) continue;
      const instrument = published(metadata, location);
      if (found) {
        throw error('ambiguous-instrument', 'More than one folder publishes this instrument ID.', {instrumentId, paths: [found.path, location]});
      }
      found = {folder: parent, path: location, raw: metadata.raw, instrument};
    }
  }
  if (!found && directError) throw directError;
  return found;
}

async function resolve(root, ref) {
  if (!validSamplerRef(ref)) throw error('invalid-reference', 'An instrument reference needs a library ID, instrument ID, revision and path.');
  const library = await readLibrary(root);
  if (library.id !== ref.libraryId) throw error('library-mismatch', 'Select the library referenced by this instrument.', {libraryId: ref.libraryId});
  try {
    const found = await locate(root, ref.instrumentId, ref.path);
    if (!found) throw error('missing-instrument', 'This instrument is missing from the library.', {path: ref.path, instrumentId: ref.instrumentId});
    let {instrument} = found;
    if (instrument.revision !== ref.revision) {
      let revision;
      if (ref.revision < instrument.revision) {
        try {
          const revisions = await found.folder.getDirectoryHandle('revisions');
          revision = await readMetadata(revisions, ref.revision + '.json');
        } catch (cause) {
          if (!existsError(cause)) throw cause;
        }
      }
      if (!revision) {
        throw error('missing-revision', 'This published instrument revision is unavailable.', {path: found.path, revision: ref.revision});
      }
      instrument = published(revision, found.path);
      if (instrument.id !== ref.instrumentId || instrument.revision !== ref.revision) {
        throw error('invalid-metadata', 'The revision identity does not match the requested instrument.', {path: found.path});
      }
    }
    return {instrument, ref: makeRef(library, instrument, found.path)};
  } catch (cause) {
    throw physicalError(cause, ref.path);
  }
}

export async function load(root, ref) {
  return (await resolve(root, ref)).instrument;
}

export async function inspect(root, ref) {
  return resolve(root, ref);
}

async function readVerified(root, sample, {maxFileBytes = Infinity, signal} = {}) {
  try {
    checkAbort(signal);
    let file;
    try {
      file = await (await fileAt(root, sample.path)).getFile();
    } catch (cause) {
      if (existsError(cause)) throw error('missing-sample', 'A referenced WAV is missing.', {path: sample.path, sampleId: sample.id});
      throw cause;
    }
    if (sample.size !== undefined && file.size !== sample.size) {
      throw error('digest-mismatch', 'The WAV size differs from the published sample.', {path: sample.path, sampleId: sample.id});
    }
    if (file.size > maxFileBytes) {
      throw error('budget-exceeded', 'The WAV file exceeds the preparation read limit.', {path: sample.path, sampleId: sample.id, limit: maxFileBytes});
    }
    const metadata = await inspectWav(file, {anyRate: true});
    if (!['frames', 'channels', 'sampleRate'].every(key => metadata[key] === sample[key])) {
      throw error('digest-mismatch', 'The WAV layout differs from the published sample.', {path: sample.path, sampleId: sample.id});
    }
    checkAbort(signal);
    const bytes = await file.arrayBuffer();
    if (await digest(bytes) !== sample.sha256) {
      throw error('digest-mismatch', 'The WAV bytes differ from the published sample.', {path: sample.path, sampleId: sample.id});
    }
    checkAbort(signal);
    return {file, bytes, metadata};
  } catch (cause) {
    const failure = physicalError(cause, sample.path);
    failure.path ??= sample.path;
    failure.sampleId ??= sample.id;
    throw failure;
  }
}

export async function readSampleFile(root, sample, options) {
  return (await readVerified(root, sample, options)).file;
}

function revisionConflict(path, expectedRevision, actualRevision) {
  return error('revision-conflict', 'The published instrument changed while this draft was open.', {path, expectedRevision, actualRevision});
}

async function commitManifest(root, path, instrument, current) {
  const folder = await directory(root, instrumentPath(path, instrument.kind), true);
  const revisions = await directory(folder, ['revisions'], true);
  const payload = json(instrument);
  if (new Blob([payload]).size > maxMetadataBytes) {
    throw error('invalid-metadata', 'This sampler manifest is too large.', {path});
  }
  const assertCurrent = async () => {
    const available = await readMetadata(folder, currentFile, {empty: true});
    if (available?.raw !== current?.raw) {
      throw revisionConflict(path, current?.instrument.revision ?? 0, available?.value?.revision ?? 0);
    }
  };
  await assertCurrent();
  const revisionName = instrument.revision + '.json';
  const previous = await readMetadata(revisions, revisionName, {empty: true}).catch(cause => {
    if (cause?.code === 'invalid-metadata') return undefined;
    throw cause;
  });
  if (previous?.raw !== payload) await put(revisions, revisionName, payload);
  await assertCurrent();
  await put(folder, currentFile, payload);
}

export async function publish(root, draft, {path, expectedRevision} = {}) {
  const instrument = validateInstrument(draft);
  instrumentPath(path, instrument.kind);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
    throw error('revision-conflict', 'Supply the last observed revision or zero for a new instrument.', {path, expectedRevision});
  }
  const library = await readLibrary(root);
  try {
    return await locked(library.id, async () => {
      const current = await locate(root, instrument.id, path);
      const destination = await readCurrent(root, path);
      const actualRevision = current?.instrument.revision ?? 0;
      if (actualRevision !== expectedRevision || (destination && destination.instrument.id !== instrument.id) ||
          (current && current.path !== path)) {
        throw revisionConflict(path, expectedRevision, destination?.instrument.revision ?? actualRevision);
      }
      for (const sample of instrument.samples) await readVerified(root, sample);
      const revised = {...instrument, revision: actualRevision + 1};
      await commitManifest(root, path, revised, current);
      return makeRef(library, revised, path);
    });
  } catch (cause) {
    throw physicalError(cause, path);
  }
}

export async function dependencies(root, ref, {signal} = {}) {
  const {instrument, ref: resolved} = await resolve(root, ref);
  const items = [];
  for (const sample of instrument.samples) {
    checkAbort(signal);
    try {
      await readVerified(root, sample, {signal});
      items.push({...sample, status: 'ok'});
    } catch (cause) {
      if (cause.code === 'cancelled') throw cause;
      items.push({...sample, status: cause.code, message: cause.message});
    }
  }
  return {ref: resolved, items};
}

export async function verify(root, ref, options) {
  const report = await dependencies(root, ref, options);
  return {...report, ok: report.items.every(item => item.status === 'ok')};
}

export async function prepare(root, ref, {signal, onProgress, limits, capabilities, maxFileBytes = maxPlaybackFileBytes} = {}) {
  checkAbort(signal);
  const {instrument, ref: resolved} = await resolve(root, ref);
  const plan = compile(instrument, capabilities, limits);
  const samples = new Map();
  const pcmByDigest = new Map();
  const checked = new Set();
  const total = plan.dependencies.length;
  onProgress?.({completed: 0, total, memoryBytes: plan.memoryBytes});
  for (const sample of plan.dependencies) {
    checkAbort(signal);
    const identity = sample.path + '\u0000' + sample.sha256 + '\u0000' + sample.size;
    if (!checked.has(identity)) {
      const {bytes, metadata} = await readVerified(root, sample, {maxFileBytes, signal});
      if (!pcmByDigest.has(sample.sha256)) pcmByDigest.set(sample.sha256, decodePCM(bytes, metadata));
      checked.add(identity);
    }
    samples.set(sample.id, pcmByDigest.get(sample.sha256));
    onProgress?.({completed: samples.size, total, sampleId: sample.id, memoryBytes: plan.memoryBytes});
  }
  checkAbort(signal);
  return {ref: resolved, instrument: plan.instrument, plan, samples};
}

function summary(entry) {
  return {name: entry.name, path: entry.path, kind: entry.kind, expandable: entry.kind === 'directory'};
}

async function describe(folder, name, handle, path) {
  const item = summary({kind: handle.kind, name, path});
  if (handle.kind === 'directory' && /^(Instruments|Kits)\//u.test(path)) {
    try {
      const metadata = await readMetadata(handle, currentFile, {empty: true});
      if (metadata) {
        const model = published(metadata, path);
        return {...item, kind: model.kind, id: model.id, displayName: model.name, tags: model.tags, revision: model.revision};
      }
    } catch (cause) {
      const failure = physicalError(cause, path);
      item.diagnostic = {code: failure.code, message: failure.message};
    }
  }
  if (handle.kind === 'file' && path.startsWith('Samples/') && /\.wav$/iu.test(name)) return {...item, kind: 'sample'};
  if (handle.kind === 'file' && path.startsWith('Presets/') && /\.json$/iu.test(name)) {
    const metadata = await readMetadata(folder, name).catch(() => undefined);
    return {...item, kind: 'preset', id: metadata?.value?.id, displayName: metadata?.value?.name, tags: metadata?.value?.tags};
  }
  return item;
}

function hidden(name, path) {
  return !path ? name === rootFile
    : instrumentBuckets.includes(path.split('/')[0]) && folded(name) === 'revisions';
}

function page(items, cursor, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || (cursor !== undefined && typeof cursor !== 'string')) {
    throw error('invalid-query', 'Choose a page of 1 to 1,000 library entries.');
  }
  items.sort((a, b) => order(a.path, b.path));
  const start = cursor === undefined ? 0 : items.findIndex(item => item.path > cursor);
  if (start < 0) return {items: [], nextCursor: null};
  const visible = items.slice(start, start + limit);
  return {items: visible, nextCursor: start + limit < items.length ? visible.at(-1).path : null};
}

export async function listChildren(root, relativeDir = '', {cursor, limit = 100} = {}) {
  await readLibrary(root);
  try {
    const folder = relativeDir ? await directory(root, samplerPath(relativeDir)) : root;
    const items = [];
    for await (const [name, handle] of entries(folder)) {
      const path = safeChild(relativeDir, name);
      if (!path || hidden(name, relativeDir) || (name === currentFile && instrumentBuckets.includes(relativeDir.split('/')[0]))) continue;
      items.push({name, path, handle});
    }
    const result = page(items, cursor, limit);
    return {
      ...result,
      items: await Promise.all(result.items.map(({name, handle, path}) => describe(folder, name, handle, path))),
    };
  } catch (cause) {
    throw physicalError(cause, relativeDir);
  }
}

export async function search(root, {kind, tags = [], text = '', cursor, limit = 100} = {}) {
  await readLibrary(root);
  const query = folded(text.trim());
  const requiredTags = tags.map(folded);
  try {
    const items = [];
    for await (const {folder, name, handle, path} of tree(root, '')) {
      if (name === currentFile && instrumentBuckets.includes(path.split('/')[0])) continue;
      const item = await describe(folder, name, handle, path);
      if (kind && item.kind !== kind) continue;
      const available = Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string').map(folded) : [];
      if (!requiredTags.every(tag => available.includes(tag))) continue;
      if (query && !folded([item.name, item.path, item.displayName, ...available].join(' ')).includes(query)) continue;
      items.push(item);
    }
    return page(items, cursor, limit);
  } catch (cause) {
    throw physicalError(cause, '');
  }
}

export async function findCandidates(root, missing, {signal} = {}) {
  await readLibrary(root);
  if (!missing?.sha256 || typeof missing.sha256 !== 'string') throw error('invalid-sample', 'A missing sample needs a digest.');
  const candidates = [];
  try {
    let folder;
    try {
      folder = await root.getDirectoryHandle('Samples');
    } catch (cause) {
      if (existsError(cause)) return {status: 'missing-sample', candidates};
      throw cause;
    }
    for await (const {handle, path, name} of tree(folder, 'Samples')) {
      checkAbort(signal);
      if (handle.kind !== 'file' || !/\.wav$/iu.test(name) || path === missing.path) continue;
      try {
        const {metadata} = await readVerified(root, {...missing, path}, {signal});
        candidates.push({path, size: metadata.size, sha256: missing.sha256});
      } catch (cause) {
        if (!['invalid-wav', 'missing-sample', 'digest-mismatch', 'unsupported-feature'].includes(cause.code)) throw cause;
      }
    }
    candidates.sort((a, b) => order(a.path, b.path));
    return {status: candidates.length > 1 ? 'ambiguous-sample' : candidates.length ? 'candidate-found' : 'missing-sample', candidates};
  } catch (cause) {
    throw physicalError(cause, 'Samples');
  }
}

export async function relink(root, ref, sampleId, candidate, {expectedRevision = ref.revision, replace = false} = {}) {
  const resolved = await resolve(root, ref);
  if (expectedRevision !== resolved.ref.revision) {
    throw revisionConflict(resolved.ref.path, expectedRevision, resolved.ref.revision);
  }
  const {instrument} = resolved;
  const sample = instrument.samples.find(item => item.id === sampleId);
  if (!sample) throw error('invalid-sample', 'The instrument has no sample with this ID.', {sampleId});
  const path = typeof candidate === 'string' ? candidate : candidate?.path;
  samplerPath(path);
  let replacement = {...sample, path};
  try {
    if (replace) {
      const file = await (await fileAt(root, path)).getFile();
      const {frames, channels, sampleRate, size} = await inspectWav(file);
      replacement = {
        ...Object.fromEntries(Object.entries(sample).filter(([key]) => !['license', 'recipe', 'source', 'provenance'].includes(key))),
        path, frames, channels, sampleRate, size, sha256: await digest(await file.arrayBuffer()),
      };
      for (const key of ['license', 'provenance', 'recipe', 'source']) {
        if (candidate?.[key] !== undefined) replacement[key] = structuredClone(candidate[key]);
      }
    } else {
      await readVerified(root, replacement);
    }
    const samples = instrument.samples.map(item => item.id === sampleId ? replacement : item);
    return publish(root, {...instrument, samples}, {path: resolved.ref.path, expectedRevision});
  } catch (cause) {
    throw physicalError(cause, path);
  }
}

export async function collect(root, ref, destination, {path, libraryName} = {}) {
  const source = await resolve(root, ref);
  if (destination === root || (await destination.isSameEntry?.(root))) {
    throw error('path-conflict', 'Choose a different folder for the self-contained copy.');
  }
  const book = await initializeLibrary(destination, {name: libraryName ?? source.instrument.name});
  const outputPath = path ?? source.ref.path;
  instrumentPath(outputPath, source.instrument.kind);
  try {
    return await locked(book.id, async () => {
      const samples = [];
      for (const [index, sample] of source.instrument.samples.entries()) {
        const {file} = await readVerified(root, sample);
        const base = samplerPath(sample.path).at(-1);
        const collection = sample.path.startsWith('Samples/Processed/') ? 'Processed' : 'Originals';
        const copied = {...sample, path: `Samples/${collection}/Sample ${index + 1}/${base}`};
        await copySample(destination, file, copied.path, copied.sha256);
        await readVerified(destination, copied);
        samples.push(copied);
      }
      const instrument = {...source.instrument, samples};
      const current = await readCurrent(destination, outputPath);
      const desired = makeRef(book, instrument, outputPath);
      if (current) {
        if (json(current.instrument) === json(instrument)) return desired;
        throw revisionConflict(outputPath, 0, current.instrument.revision);
      }
      if (await locate(destination, instrument.id)) throw revisionConflict(outputPath, 0, instrument.revision);
      await commitManifest(destination, outputPath, instrument, undefined);
      const report = await verify(destination, desired);
      if (!report.ok) throw error('invalid-export', 'The self-contained instrument could not be reopened.', {path: outputPath, items: report.items});
      return desired;
    });
  } catch (cause) {
    throw physicalError(cause, outputPath);
  }
}
