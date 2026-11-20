// SPDX-License-Identifier: GPL-3.0-only

import {SamplerError, samplerPath} from './sampler-instrument.js';

import {entries, fileAt, folded, permissionDenied, withFilesystemLock, writeFileHandle} from './sampler-filesystem.js';

export function exportName(name) {
  if (samplerPath(name).length !== 1) throw new SamplerError('invalid-path', 'Choose a single name for the export folder.', {path: name});
  return name;
}

export async function openRelativeFile(root, path) {
  return (await fileAt(root, path)).getFile();
}

export async function assertAvailable(directory, name) {
  try {
    for await (const [actual] of entries(directory)) {
      if (folded(actual) === folded(name)) {
        throw new SamplerError('path-conflict', 'The destination already contains this name.', {path: name, actual});
      }
    }
  } catch (cause) {
    if (permissionDenied(cause)) {
      throw new SamplerError('permission-required', 'Grant access to the export folder again.', {cause});
    }
    throw cause;
  }
}

async function writeFile(directory, path, payload, allowedFolders, created) {
  const parts = samplerPath(path);
  const name = parts.pop();
  let location = '';
  for (const part of parts) {
    location += '/' + part;
    if (!allowedFolders.has(location)) {
      await assertAvailable(directory, part);
      const parent = directory;
      directory = await directory.getDirectoryHandle(part, {create: true});
      created.push({parent, name: part});
      allowedFolders.set(location, directory);
    } else {
      directory = allowedFolders.get(location);
    }
  }
  await assertAvailable(directory, name);
  const handle = await directory.getFileHandle(name, {create: true});
  created.push({parent: directory, name, payload, handle});
  await writeFileHandle(handle, payload);
}

async function sameContents(handle, payload) {
  const file = await handle.getFile();
  const bytes = new Blob([payload]);
  if (file.size === 0) return true;
  if (file.size !== bytes.size) return false;
  const a = new Uint8Array(await file.arrayBuffer());
  const b = new Uint8Array(await bytes.arrayBuffer());
  return a.every((value, index) => value === b[index]);
}

async function rollback(created) {
  for (const entry of created.reverse()) {
    try {
      if (!entry.handle || await sameContents(entry.handle, entry.payload)) await entry.parent.removeEntry(entry.name);
    } catch {
      // Another process may already have edited the path or left the directory nonempty.
    }
  }
}

export async function writeBundle(destination, name, files, {signal, reopen} = {}) {
  exportName(name);
  const write = async () => {
    const created = [];
    try {
      signal?.throwIfAborted();
      await assertAvailable(destination, name);
      const target = await destination.getDirectoryHandle(name, {create: true});
      created.push({parent: destination, name});
      const folders = new Map();
      for (const entry of files) {
        signal?.throwIfAborted();
        await writeFile(target, entry.path, entry.content, folders, created);
      }
      signal?.throwIfAborted();
      return await reopen?.(target);
    } catch (cause) {
      await rollback(created);
      if (cause instanceof SamplerError) throw cause;
      if (signal?.aborted) throw new SamplerError('cancelled', 'The export was cancelled.', {cause});
      if (permissionDenied(cause)) {
        throw new SamplerError('permission-required', 'Grant access to the export folder again.', {cause});
      }
      throw new SamplerError('export-failed', 'Unable to save and reopen the export.', {path: name, cause});
    }
  };
  return withFilesystemLock('waswan-sampler-export:' + folded(name), write);
}
