// SPDX-License-Identifier: GPL-3.0-only

import {SamplerError, samplerPath} from './sampler-instrument.js';

export const maxMetadataBytes = 4 * 1024 * 1024;
export const folded = value => value.normalize('NFC').toLowerCase();
export const notFound = cause => cause?.name === 'NotFoundError';
const error = (code, message, details) => new SamplerError(code, message, details);
const localLocks = new Map();

export function permissionDenied(cause) {
  return ['NotAllowedError', 'SecurityError', 'EACCES', 'EPERM'].includes(cause?.name) ||
    ['EACCES', 'EPERM'].includes(cause?.code);
}

export function physicalError(cause, path) {
  if (cause instanceof SamplerError) return cause;
  const details = {path, cause};
  if (permissionDenied(cause)) {
    return error('permission-required', 'Grant access to the sampler library folder again.', details);
  }
  if (cause?.name === 'QuotaExceededError' || cause?.code === 'ENOSPC') {
    return error('storage-full', 'Free storage space in the Samples folder and retry.', details);
  }
  if (notFound(cause)) return error('missing-path', 'This path is missing from the sampler library.', details);
  if (cause?.name === 'TypeMismatchError') return error('path-conflict', 'A file or folder already uses this name.', details);
  return error('filesystem-error', 'Unable to access the sampler library file.', details);
}

export async function withFilesystemLock(name, run) {
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

export async function* entries(directory) {
  if (typeof directory.entries === 'function') yield* directory.entries();
  else for await (const handle of directory.values()) yield [handle.name, handle];
}

export async function ensureFreeSpelling(folder, name, path) {
  for await (const [actual] of entries(folder)) {
    if (actual !== name && folded(actual) === folded(name)) {
      throw error('path-conflict', 'This folder already contains a name that differs only in spelling or case.', {path, actual});
    }
  }
}

export async function directory(root, segments, create = false) {
  let folder = root;
  for (const name of segments) {
    if (create) await ensureFreeSpelling(folder, name, segments.join('/'));
    folder = await folder.getDirectoryHandle(name, {create});
  }
  return folder;
}

export async function fileAt(root, path) {
  const segments = samplerPath(path);
  const name = segments.pop();
  return (await directory(root, segments)).getFileHandle(name);
}

export async function optionalFile(folder, name) {
  try {
    return await (await folder.getFileHandle(name)).getFile();
  } catch (cause) {
    if (notFound(cause)) return undefined;
    throw cause;
  }
}

export async function readMetadata(folder, name, {empty = false} = {}) {
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

export async function put(folder, name, payload) {
  await ensureFreeSpelling(folder, name, name);
  return writeFileHandle(await folder.getFileHandle(name, {create: true}), payload);
}

export async function writeFileHandle(handle, payload) {
  const writer = await handle.createWritable();
  try {
    await writer.write(payload);
    await writer.close();
  } catch (cause) {
    await writer.abort().catch(() => {});
    throw cause;
  }
}
