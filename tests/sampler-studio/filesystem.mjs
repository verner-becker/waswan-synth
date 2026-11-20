// SPDX-License-Identifier: GPL-3.0-only

import {randomUUID} from 'node:crypto';
import {openAsBlob} from 'node:fs';
import {lstat, mkdir, open, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {SamplerError, samplerPath} from '../../web/sampler-instrument.js';

const present = async path => {
  try {
    return await lstat(path);
  } catch (cause) {
    if (cause.code === 'ENOENT') return undefined;
    throw cause;
  }
};

function guard(stat, path) {
  if (stat?.isSymbolicLink()) throw new SamplerError('invalid-path', 'Symbolic links are outside the physical test adapter.', {path});
  return stat;
}

const missing = path => new DOMException(path, 'NotFoundError');
const wrongKind = path => new DOMException(path, 'TypeMismatchError');

export async function diskDirectory(path, hooks = {}) {
  const base = await realpath(path);
  if (!(await lstat(base)).isDirectory()) throw wrongKind(path);
  const ensureDirectory = async dir => {
    const stat = guard(await present(dir), dir);
    if (!stat) throw missing(dir);
    if (!stat.isDirectory() || await realpath(dir) !== dir) throw wrongKind(dir);
  };
  const child = (dir, name) => {
    if (samplerPath(name).length !== 1) throw new SamplerError('invalid-path', 'Expected one path component.', {path: name});
    return join(dir, name);
  };
  const makeDirectory = dir => ({
    kind: 'directory',
    name: basename(dir),
    async isSameEntry(other) {
      return other?.diskPath === dir;
    },
    diskPath: dir,
    async *entries() {
      await ensureDirectory(dir);
      for (const item of await readdir(dir, {withFileTypes: true})) {
        if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) yield [item.name, makeDirectory(join(dir, item.name))];
        if (item.isFile()) yield [item.name, makeFile(dir, item.name)];
      }
    },
    async getDirectoryHandle(name, {create = false} = {}) {
      await ensureDirectory(dir);
      const target = child(dir, name);
      let stat = guard(await present(target), target);
      if (!stat && create) {
        await mkdir(target).catch(cause => {
          if (cause.code !== 'EEXIST') throw cause;
        });
        stat = guard(await present(target), target);
      }
      if (!stat) throw missing(target);
      if (!stat.isDirectory()) throw wrongKind(target);
      return makeDirectory(target);
    },
    async getFileHandle(name, {create = false} = {}) {
      await ensureDirectory(dir);
      const target = child(dir, name);
      let stat = guard(await present(target), target);
      if (!stat && create) {
        try {
          await (await open(target, 'ax')).close();
        } catch (cause) {
          if (cause.code !== 'EEXIST') throw cause;
        }
        stat = guard(await present(target), target);
      }
      if (!stat) throw missing(target);
      if (!stat.isFile()) throw wrongKind(target);
      return makeFile(dir, name);
    },
    async removeEntry(name) {
      await ensureDirectory(dir);
      await rm(child(dir, name));
    },
  });
  const makeFile = (dir, name) => {
    const target = join(dir, name);
    const ensureFile = async () => {
      await ensureDirectory(dir);
      const stat = guard(await present(target), target);
      if (!stat) throw missing(target);
      if (!stat.isFile()) throw wrongKind(target);
    };
    return {
      kind: 'file',
      name,
      async getFile() {
        await ensureFile();
        await hooks.onRead?.(target);
        return openAsBlob(target);
      },
      async createWritable() {
        await ensureFile();
        const temporary = join(dir, '.sampler-write-' + randomUUID());
        return {
          async write(payload) {
            await ensureDirectory(dir);
            await writeFile(temporary, payload instanceof Blob ? new Uint8Array(await payload.arrayBuffer()) : payload, {flag: 'wx'});
          },
          async close() {
            await ensureFile();
            await hooks.onClose?.(target, temporary);
            await rename(temporary, target);
          },
          async abort() {
            await ensureDirectory(dir);
            await rm(temporary, {force: true});
          },
        };
      },
    };
  };
  return makeDirectory(base);
}
