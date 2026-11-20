// SPDX-License-Identifier: GPL-3.0-only

import {SamplerError, compile, samplerLimits, samplerPath, validSamplerId, validSamplerRef, validateInstrument} from './sampler-instrument.js';
import {
  directory, ensureFreeSpelling, entries, fileAt, folded, maxMetadataBytes, notFound, optionalFile,
  physicalError, put, readMetadata, withFilesystemLock,
} from './sampler-filesystem.js';
import {asBlob, decodePCM, inspectWav} from './sampler-wav.js';
import {applySamplerPreset, samplerLabel, samplerPresetFormat, samplerTags, validateSamplerPreset} from './sampler-preset.js';

export {decodeWav, inspectWav} from './sampler-wav.js';
export {applySamplerPreset, createSamplerPreset, validateSamplerPreset} from './sampler-preset.js';

const libraryFormat = 'waswan-sampler-library';
const rootFile = 'library.json';
const currentFile = 'instrument.json';
const sampleFormat = 'waswan-sampler-sample';
const sidecarSuffix = '.sample.json';
const instrumentBuckets = ['Instruments', 'Kits'];
const collections = [...instrumentBuckets, 'Samples', 'Presets'];
const maxPlaybackFileBytes = samplerLimits.memoryBytes + 16 * 1024 * 1024;

const error = (code, message, details) => new SamplerError(code, message, details);
const json = value => JSON.stringify(value, null, 2) + '\n';
const order = (a, b) => a < b ? -1 : Number(a > b);
const locked = (id, operation) => withFilesystemLock('waswan-sampler-library:' + id, operation);

function checkAbort(signal) {
  if (signal?.aborted) throw error('cancelled', 'Sampler preparation was cancelled.');
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

function normalizeSample(model, path) {
  if (!model || !validSamplerId(model.id) || typeof model.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(model.sha256) ||
      ![1, 2].includes(model.channels) || ![44100, 48000].includes(model.sampleRate) ||
      !Number.isSafeInteger(model.frames) || model.frames < 1 ||
      !Number.isSafeInteger(model.size) || model.size < 44 + model.frames * model.channels * 2) {
    throw error('invalid-sample', 'The sample metadata has an invalid identity or WAV layout.', {path});
  }
  const name = samplerLabel(model.name, samplerPath(path).at(-1).slice(0, -4));
  const {format, version, ...fields} = model;
  return {...fields, path, name, tags: samplerTags(model.tags)};
}

async function sidecarName(wavName) {
  const label = wavName + sidecarSuffix;
  const encoder = new TextEncoder();
  if (encoder.encode(label).length <= 255) return label;
  return '.' + await digest(encoder.encode(wavName)) + sidecarSuffix;
}

async function sampleSidecar(folder, wavName, path) {
  const metadata = await readMetadata(folder, await sidecarName(wavName), {empty: true});
  if (!metadata) return undefined;
  if (metadata.value?.format !== sampleFormat || metadata.value.version !== 1) {
    throw error('unsupported-feature', 'This sample metadata version is unavailable.', {path});
  }
  return normalizeSample(metadata.value, path);
}

async function writeSampleSidecar(folder, wavName, sample) {
  const payload = json({format: sampleFormat, version: 1, ...sample});
  if (new Blob([payload]).size > maxMetadataBytes) {
    throw error('invalid-metadata', 'The sample metadata file is too large.', {path: sample.path});
  }
  await put(folder, await sidecarName(wavName), payload);
}

function sampleLocation(path) {
  const segments = samplerPath(path);
  const name = segments.pop();
  if (!/\.wav$/iu.test(name)) throw error('invalid-path', 'Choose a library WAV path.', {path});
  return {segments, name};
}

async function describeFile(root, path, expected = {}, signal) {
  checkAbort(signal);
  const {segments, name} = sampleLocation(path);
  let folder, file;
  try {
    folder = await directory(root, segments);
    file = await (await folder.getFileHandle(name)).getFile();
  } catch (cause) {
    if (notFound(cause)) throw error('missing-sample', 'A referenced WAV is missing.', {path});
    throw cause;
  }
  const saved = await sampleSidecar(folder, name, path);
  const {size, sampleRate, channels, frames} = await inspectWav(file, {anyRate: true});
  const layout = {size, sampleRate, channels, frames};
  if (Object.keys(layout).some(key =>
    (expected[key] !== undefined && expected[key] !== layout[key]) || (saved && saved[key] !== layout[key]))) {
    throw error('digest-mismatch', 'The WAV layout differs from the recorded sample.', {path});
  }
  checkAbort(signal);
  const sha256 = await digest(await file.arrayBuffer());
  if ((expected.sha256 && expected.sha256 !== sha256) || (saved && saved.sha256 !== sha256)) {
    throw error('digest-mismatch', 'The WAV bytes differ from the recorded sample.', {path});
  }
  checkAbort(signal);
  const descriptor = normalizeSample({
    ...saved, ...expected, id: expected.id ?? saved?.id ?? 'sample-' + sha256.slice(0, 32),
    sha256, ...layout,
  }, path);
  return {descriptor, file, folder, name};
}

export async function inspectSample(root, path, {verify = false, signal} = {}) {
  await readLibrary(root);
  try {
    checkAbort(signal);
    const {segments, name} = sampleLocation(path);
    const folder = await directory(root, segments);
    const saved = await sampleSidecar(folder, name, path);
    if (saved) {
      if (!await optionalFile(folder, name)) throw error('missing-sample', 'A referenced WAV is missing.', {path});
      if (verify) await readVerified(root, saved, {signal});
      return saved;
    }
    return (await describeFile(root, path, {}, signal)).descriptor;
  } catch (cause) {
    throw physicalError(cause, path);
  }
}

export async function updateSampleMetadata(root, path, changes, {expectedSha256, signal} = {}) {
  const library = await readLibrary(root);
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw error('invalid-sample', 'Supply the verified sample digest before updating its metadata.', {path});
  }
  try {
    return await locked(library.id, async () => {
      const {descriptor, folder, name} = await describeFile(root, path, {sha256: expectedSha256}, signal);
      const properties = Object.entries(changes).filter(([key]) => ['name', 'tags', 'license', 'provenance'].includes(key));
      if (properties.length !== Object.keys(changes).length) {
        throw error('invalid-sample', 'Only the name, tags, license and provenance can be edited here.', {path});
      }
      const sample = normalizeSample({...descriptor, ...Object.fromEntries(properties)}, path);
      await writeSampleSidecar(folder, name, sample);
      return sample;
    });
  } catch (cause) {
    throw physicalError(cause, path);
  }
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
  const {id, provenance, license, recipe, source: sourceIdentity, name: displayName, tags} = options;
  if (id !== undefined && !validSamplerId(id)) throw error('invalid-sample', 'Choose a valid sample identifier.', {path});
  originalPath(path);
  try {
    const library = await readLibrary(root);
    const file = asBlob(source);
    const {frames, channels, sampleRate, size} = await inspectWav(file, {anyRate: true});
    if (![44100, 48000].includes(sampleRate)) {
      throw error('unsupported-feature', 'The library currently imports PCM16 at 44.1 or 48 kHz.', {path});
    }
    const sha256 = await digest(await file.arrayBuffer());
    const additions = {};
    for (const [key, value] of Object.entries({provenance, license, recipe, source: sourceIdentity, name: displayName, tags})) {
      if (value !== undefined) additions[key] = structuredClone(value);
    }
    const fresh = normalizeSample({id: id ?? globalThis.crypto.randomUUID(), path, sha256, frames, channels, sampleRate, size, ...additions}, path);
    return await locked(library.id, async () => {
      const {segments, name} = sampleLocation(path);
      const folder = await directory(root, segments, true);
      const saved = await sampleSidecar(folder, name, path);
      if (saved && saved.sha256 !== sha256) throw error('path-conflict', 'Different metadata already uses this WAV path.', {path});
      await copySample(root, file, path, sha256);
      if (!saved) await writeSampleSidecar(folder, name, fresh);
      // A manifest can use its own sample identifier while the catalog keeps the asset identifier.
      return saved ? normalizeSample({...saved, ...additions, id: id ?? saved.id}, path) : fresh;
    });
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
    if (notFound(cause)) return undefined;
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
      if (notFound(cause)) continue;
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

async function resolve(root, ref, {latest = false} = {}) {
  if (!validSamplerRef(ref)) throw error('invalid-reference', 'An instrument reference needs a library ID, instrument ID, revision and path.');
  const library = await readLibrary(root);
  if (library.id !== ref.libraryId) throw error('library-mismatch', 'Select the library referenced by this instrument.', {libraryId: ref.libraryId});
  try {
    const found = await locate(root, ref.instrumentId, ref.path);
    if (!found) throw error('missing-instrument', 'This instrument is missing from the library.', {path: ref.path, instrumentId: ref.instrumentId});
    let {instrument} = found;
    if (!latest && instrument.revision !== ref.revision) {
      let revision;
      if (ref.revision < instrument.revision) {
        try {
          const revisions = await found.folder.getDirectoryHandle('revisions');
          revision = await readMetadata(revisions, ref.revision + '.json');
        } catch (cause) {
          if (!notFound(cause)) throw cause;
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

export async function inspect(root, ref, options) {
  return resolve(root, ref, options);
}

async function readVerified(root, sample, {maxFileBytes = Infinity, signal} = {}) {
  try {
    checkAbort(signal);
    let file;
    try {
      file = await (await fileAt(root, sample.path)).getFile();
    } catch (cause) {
      if (notFound(cause)) throw error('missing-sample', 'A referenced WAV is missing.', {path: sample.path, sampleId: sample.id});
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

export async function prepareInstrument(root, instrument, {signal, onProgress, limits, capabilities, maxFileBytes = maxPlaybackFileBytes} = {}) {
  checkAbort(signal);
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
  return {instrument: plan.instrument, plan, samples};
}

export async function prepare(root, ref, options = {}) {
  checkAbort(options.signal);
  const {instrument, ref: resolved} = await resolve(root, ref);
  return {ref: resolved, ...await prepareInstrument(root, instrument, options)};
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
  if (handle.kind === 'file' && path.startsWith('Samples/') && /\.wav$/iu.test(name)) {
    try {
      const sample = await sampleSidecar(folder, name, path);
      if (sample) return {...item, kind: 'sample', id: sample.id, displayName: sample.name, tags: sample.tags};
    } catch (cause) {
      const failure = physicalError(cause, path);
      item.diagnostic = {code: failure.code, message: failure.message};
    }
    return {...item, kind: 'sample'};
  }
  if (handle.kind === 'file' && path.startsWith('Presets/') && /\.json$/iu.test(name)) {
    const metadata = await readMetadata(folder, name).catch(() => undefined);
    if (metadata?.value?.format === samplerPresetFormat) {
      try {
        const preset = validateSamplerPreset(metadata.value);
        return {...item, kind: 'preset', id: preset.id, displayName: preset.name, tags: preset.tags, revision: preset.revision, ref: preset.ref};
      } catch (cause) {
        item.diagnostic = {code: cause.code, message: cause.message};
      }
    }
    return {...item, kind: 'preset', id: metadata?.value?.id, displayName: metadata?.value?.name, tags: metadata?.value?.tags};
  }
  return item;
}

function hidden(name, path) {
  if (!path) return name === rootFile;
  const category = path.split('/')[0];
  return (instrumentBuckets.includes(category) && folded(name) === 'revisions') ||
    (category === 'Samples' && folded(name).endsWith(sidecarSuffix));
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
      if (notFound(cause)) return {status: 'missing-sample', candidates};
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

export async function relinkMatches(root, ref, matches, {expectedRevision = ref.revision} = {}) {
  const {instrument,ref:resolved} = await resolve(root,ref);
  if (expectedRevision !== resolved.revision) throw revisionConflict(resolved.path,expectedRevision,resolved.revision);
  if (!(matches instanceof Map) || !matches.size || [...matches.keys()].some(id=>!instrument.samples.some(s=>s.id===id))) {
    throw error('invalid-sample','Choose a verified replacement for a referenced sample.');
  }
  const samples=instrument.samples.map(sample=>{
    if(!matches.has(sample.id))return sample;
    const path=matches.get(sample.id);
    samplerPath(path);
    return {...sample,path};
  });
  // publish verifies every original hash and compares the current revision under lock.
  return publish(root,{...instrument,samples},{path:resolved.path,expectedRevision});
}

export async function relink(root, ref, sampleId, candidate, {expectedRevision = ref.revision, replace = false} = {}) {
  if(!replace)return relinkMatches(root,ref,new Map([[sampleId,typeof candidate==='string'?candidate:candidate?.path]]),{expectedRevision});
  const resolved = await resolve(root, ref);
  if (expectedRevision !== resolved.ref.revision) {
    throw revisionConflict(resolved.ref.path, expectedRevision, resolved.ref.revision);
  }
  const {instrument} = resolved;
  const sample = instrument.samples.find(item => item.id === sampleId);
  if (!sample) throw error('invalid-sample', 'The instrument has no sample with this ID.', {sampleId});
  const path = typeof candidate === 'string' ? candidate : candidate?.path;
  samplerPath(path);
  try {
    const file = await (await fileAt(root, path)).getFile();
    const {frames, channels, sampleRate, size} = await inspectWav(file);
    const replacement = {
      ...Object.fromEntries(Object.entries(sample).filter(([key]) => !['license', 'recipe', 'source', 'provenance'].includes(key))),
      path, frames, channels, sampleRate, size, sha256: await digest(await file.arrayBuffer()),
    };
    for (const key of ['license', 'provenance', 'recipe', 'source']) {
      if (candidate?.[key] !== undefined) replacement[key] = structuredClone(candidate[key]);
    }
    const samples = instrument.samples.map(item => item.id === sampleId ? replacement : item);
    return publish(root, {...instrument, samples}, {path: resolved.ref.path, expectedRevision});
  } catch (cause) {
    throw physicalError(cause, path);
  }
}

function presetPath(path) {
  const segments = samplerPath(path);
  const name = segments.pop();
  if (segments[0] !== 'Presets' || !/\.json$/iu.test(name)) {
    throw error('invalid-path', 'Choose a JSON file under Presets.', {path});
  }
  return {segments, name};
}

async function presetAt(root, path) {
  const {segments, name} = presetPath(path);
  let folder;
  try {
    folder = await directory(root, segments);
  } catch (cause) {
    if (notFound(cause)) return undefined;
    throw cause;
  }
  const saved = await readMetadata(folder, name, {empty: true});
  if (!saved) return undefined;
  return {raw: saved.raw, preset: validateSamplerPreset(saved.value)};
}

export async function loadSamplerPreset(root, path) {
  const library = await readLibrary(root);
  try {
    const saved = await presetAt(root, path);
    if (!saved?.preset.revision) throw error('missing-preset', 'The sampler preset is unavailable.', {path});
    if (saved.preset.ref.libraryId !== library.id) {
      throw error('library-mismatch', 'The preset refers to a different sampler library.', {path, libraryId: saved.preset.ref.libraryId});
    }
    return saved.preset;
  } catch (cause) {
    throw physicalError(cause, path);
  }
}

export async function resolveSamplerPreset(root, source) {
  const preset = typeof source === 'string' ? await loadSamplerPreset(root, source) : validateSamplerPreset(source);
  const {instrument, ref} = await resolve(root, preset.ref);
  return {preset, instrument: applySamplerPreset(instrument, preset), ref};
}

export async function saveSamplerPreset(root, draft, {path, expectedRevision = 0} = {}) {
  const {segments, name} = presetPath(path);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
    throw error('revision-conflict', 'Supply the last observed preset revision or zero for a new preset.', {path, expectedRevision});
  }
  const library = await readLibrary(root);
  try {
    return await locked(library.id, async () => {
      const {preset, ref} = await resolveSamplerPreset(root, draft);
      const current = await presetAt(root, path);
      const actualRevision = current?.preset.revision ?? 0;
      if (expectedRevision !== actualRevision || (current && current.preset.id !== preset.id)) {
        throw revisionConflict(path, expectedRevision, actualRevision);
      }
      const next = {...preset, ref, revision: actualRevision + 1};
      const payload = json(next);
      if (new Blob([payload]).size > maxMetadataBytes) throw error('invalid-metadata', 'The sampler preset is too large.', {path});
      const folder = await directory(root, segments, true);
      const available = await presetAt(root, path);
      if (available?.raw !== current?.raw) throw revisionConflict(path, expectedRevision, available?.preset.revision ?? 0);
      await put(folder, name, payload);
      return next;
    });
  } catch (cause) {
    throw physicalError(cause, path);
  }
}

export async function materializeSamplerPreset(root, source, {id, path, expectedRevision = 0, name} = {}) {
  const {preset, instrument, ref} = await resolveSamplerPreset(root, source);
  if (!validSamplerId(id) || id === ref.instrumentId) {
    throw error('invalid-preset', 'Choose a new instrument ID for this playable preset.', {instrumentId: id});
  }
  const draft = {...instrument, id, name: samplerLabel(name, preset.name), revision: 0,
    preset: {id: preset.id, revision: preset.revision, ref}};
  return publish(root, draft, {path, expectedRevision});
}

async function originalReference(root, source, manifest) {
  if (!source || typeof source !== 'object' || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256)) {
    throw error('invalid-source', 'A derived sample needs the original WAV digest.');
  }
  if (source.path !== undefined) {
    sampleLocation(source.path);
    const known = manifest.find(sample => sample.path === source.path && sample.sha256 === source.sha256);
    return {...known, ...source};
  }
  const matches = manifest.filter(sample => sample.id === source.id && sample.sha256 === source.sha256);
  if (matches.length === 1) return {...source, path: matches[0].path};
  if (validSamplerId(source.id)) {
    const candidates = [];
    for (let next; next !== null;) {
      const page = await search(root, {kind: 'sample', cursor: next});
      for (const item of page.items) {
        if (item.id !== source.id) continue;
        if ((await inspectSample(root, item.path)).sha256 === source.sha256) candidates.push(item.path);
      }
      next = page.nextCursor;
    }
    if (candidates.length === 1) return {...source, path: candidates[0]};
    if (candidates.length > 1) throw error('ambiguous-sample', 'More than one WAV matches this derivative source.', {paths: candidates});
  }
  throw error('missing-sample', 'The original WAV location is missing from this derivative.', {sampleId: source.id});
}

async function planCollection(root, manifest) {
  const assets = new Map();
  const visiting = new Set();
  const walk = async expected => {
    const key = JSON.stringify([expected.path, expected.sha256]);
    if (assets.has(key)) return assets.get(key).descriptor;
    if (visiting.has(key)) throw error('cyclic-source', 'A sample recipe refers back to a dependent WAV.', {path: expected.path});
    visiting.add(key);
    const {file, descriptor: original} = await describeFile(root, expected.path, expected);
    const descriptor = {...original};
    const base = sampleLocation(expected.path).name;
    if (descriptor.source != null) {
      const link = await originalReference(root, descriptor.source, manifest);
      const parent = await walk(link);
      descriptor.source = {...descriptor.source, path: parent.path, sha256: parent.sha256};
    }
    const category = descriptor.source || expected.path.startsWith('Samples/Processed/') ? 'Processed' : 'Originals';
    descriptor.path = `Samples/${category}/Sample ${assets.size + 1}/${base}`;
    visiting.delete(key);
    assets.set(key, {descriptor, file});
    return descriptor;
  };
  const samples = [];
  for (const sample of manifest) {
    const copied = await walk(sample);
    samples.push({...sample, ...copied, id: sample.id});
  }
  return {assets, samples};
}

export async function collect(root, ref, destination, {path, libraryName} = {}) {
  const source = await resolve(root, ref);
  if (destination === root || (await destination.isSameEntry?.(root))) {
    throw error('path-conflict', 'Choose a different folder for the self-contained copy.');
  }
  const outputPath = path ?? source.ref.path;
  instrumentPath(outputPath, source.instrument.kind);
  try {
    const {assets, samples} = await planCollection(root, source.instrument.samples);
    const book = await initializeLibrary(destination, {name: libraryName ?? source.instrument.name});
    return await locked(book.id, async () => {
      const instrument = {...source.instrument, samples};
      const current = await readCurrent(destination, outputPath);
      const desired = makeRef(book, instrument, outputPath);
      if ((current && json(current.instrument) !== json(instrument)) ||
          (!current && await locate(destination, instrument.id))) {
        throw revisionConflict(outputPath, 0, current?.instrument.revision ?? instrument.revision);
      }
      for (const {descriptor, file} of assets.values()) {
        await copySample(destination, file, descriptor.path, descriptor.sha256);
        await readVerified(destination, descriptor);
        const {segments, name} = sampleLocation(descriptor.path);
        const folder = await directory(destination, segments);
        const saved = await sampleSidecar(folder, name, descriptor.path);
        if (!saved) await writeSampleSidecar(folder, name, descriptor);
        else if (saved.sha256 !== descriptor.sha256 || JSON.stringify(saved.source) !== JSON.stringify(descriptor.source)) {
          throw error('path-conflict', 'Different metadata already uses this sample in the destination.', {path: descriptor.path});
        }
      }
      if (!current) await commitManifest(destination, outputPath, instrument, undefined);
      const report = await verify(destination, desired);
      if (!report.ok) throw error('invalid-export', 'The self-contained instrument could not be reopened.', {path: outputPath, items: report.items});
      return desired;
    });
  } catch (cause) {
    throw physicalError(cause, outputPath);
  }
}
