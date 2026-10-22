import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, opendirSync, readSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project, type FileSystemHost } from 'ts-morph';
import * as morph from 'ts-morph';
import type { CompilerReadReceipt } from '../candidates/types.js';

// The installed runtime exports the host error even though its declaration omits the export.
const FileNotFoundError = (morph as typeof morph & { FileNotFoundError: new (path: string) => Error })
  .FileNotFoundError;

export const COMPILER_READ_LIMITS = {
  maxCompilerReads: 4096,
  maxCompilerFileBytes: 4 * 1024 * 1024,
  maxCompilerBytes: 64 * 1024 * 1024,
  maxCompilerProbes: 50_000,
  maxCompilerDirectoryEntries: 10_000,
};

/** Observe and bound the filesystem supplied to the existing compiler project. */
export function createObservedCompilerFileSystem(projectRoot: string, signal?: AbortSignal) {
  const base = new Project({ skipLoadingLibFiles: true }).getFileSystem();
  const reads: CompilerReadReceipt[] = [];
  const used = {
    compilerReads: 0,
    compilerBytes: 0,
    compilerReadRequests: 0,
    compilerProbes: 0,
    compilerDirectoryEntries: 0,
    compilerReadFailures: 0,
    compilerBudgetFailures: 0,
  };
  const snapshots = new Map<string, string>();
  const failures = new Set<string>();
  const unavailable = (path: string, reason: string): never => {
    used.compilerReadFailures++;
    if (reason.includes('budget')) used.compilerBudgetFailures++;
    const key = `${path}:${reason}`;
    if (!failures.has(key) && reads.length < COMPILER_READ_LIMITS.maxCompilerReads + 1) {
      failures.add(key);
      reads.push({ path, kind: 'compiler', textHash: null, byteLength: 0, outcome: 'unavailable', reason });
    }
    if (reason === 'compiler-source-read-failed') throw new FileNotFoundError(path);
    throw new Error(reason);
  };
  const probe = (path: string): boolean => {
    if (signal?.aborted) {
      if (!failures.has('probe-cancelled')) {
        failures.add('probe-cancelled');
        used.compilerReadFailures++;
        reads.push({
          path,
          kind: 'compiler',
          textHash: null,
          byteLength: 0,
          outcome: 'unavailable',
          reason: 'compiler-analysis-cancelled',
        });
      }
      return false;
    }
    if (used.compilerProbes >= COMPILER_READ_LIMITS.maxCompilerProbes) {
      if (!failures.has('probe-budget')) {
        failures.add('probe-budget');
        used.compilerBudgetFailures++;
        reads.push({
          path,
          kind: 'compiler',
          textHash: null,
          byteLength: 0,
          outcome: 'unavailable',
          reason: 'compiler-probe-budget-exhausted',
        });
      }
      return false;
    }
    used.compilerProbes++;
    return true;
  };
  const read = (input: string): string => {
    const path = resolve(input);
    used.compilerReadRequests++;
    if (signal?.aborted) return unavailable(path, 'compiler-analysis-cancelled');
    const saved = snapshots.get(path);
    if (saved !== undefined) return saved;
    if (used.compilerReads >= COMPILER_READ_LIMITS.maxCompilerReads)
      return unavailable(path, 'compiler-read-budget-exhausted');
    used.compilerReads++;
    let fd: number | undefined;
    try {
      fd = openSync(path, 'r');
      const info = fstatSync(fd);
      if (!info.isFile()) return unavailable(path, 'compiler-source-not-file');
      if (
        info.size > COMPILER_READ_LIMITS.maxCompilerFileBytes ||
        used.compilerBytes + info.size > COMPILER_READ_LIMITS.maxCompilerBytes
      )
        return unavailable(path, 'compiler-byte-budget-exhausted');
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        if (signal?.aborted) return unavailable(path, 'compiler-analysis-cancelled');
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) break;
        offset += count;
        used.compilerBytes += count;
      }
      const after = fstatSync(fd);
      if (offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs)
        return unavailable(path, 'compiler-source-changed-during-read');
      const text = bytes.toString('utf8');
      snapshots.set(path, text);
      reads.push({
        path,
        kind: 'compiler',
        textHash: createHash('sha256').update(text).digest('hex'),
        byteLength: offset,
        outcome: 'read',
        reason: null,
      });
      return text;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('compiler-')) throw error;
      return unavailable(path, 'compiler-source-read-failed');
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const readDirectory = (input: string): ReturnType<FileSystemHost['readDirSync']> => {
    const path = resolve(input);
    if (!probe(path)) return [];
    const entries: ReturnType<FileSystemHost['readDirSync']> = [];
    const directory = opendirSync(path);
    try {
      while (used.compilerDirectoryEntries < COMPILER_READ_LIMITS.maxCompilerDirectoryEntries) {
        if (signal?.aborted) {
          probe(path);
          return entries;
        }
        const entry = directory.readSync();
        if (!entry) return entries;
        used.compilerDirectoryEntries++;
        entries.push({
          name: resolve(path, entry.name),
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          isSymlink: entry.isSymbolicLink(),
        });
      }
      if (!failures.has('directory-budget')) {
        failures.add('directory-budget');
        used.compilerBudgetFailures++;
        reads.push({
          path,
          kind: 'compiler',
          textHash: null,
          byteLength: 0,
          outcome: 'unavailable',
          reason: 'compiler-directory-budget-exhausted',
        });
      }
      return entries;
    } finally {
      directory.closeSync();
    }
  };
  const exists = (path: string, directory: boolean): boolean => {
    if (!probe(path)) return false;
    try {
      const info = statSync(path);
      return directory ? info.isDirectory() : info.isFile();
    } catch {
      return false;
    }
  };
  const prohibited = () => {
    throw new Error('Compiler filesystem is read-only');
  };
  const overrides: Partial<FileSystemHost> = {
    readFileSync: read,
    readFile: async (path) => read(path),
    readDirSync: readDirectory,
    fileExistsSync: (path) => exists(path, false),
    fileExists: async (path) => exists(path, false),
    directoryExistsSync: (path) => exists(path, true),
    directoryExists: async (path) => exists(path, true),
    getCurrentDirectory: () => projectRoot,
    globSync: prohibited,
    glob: async () => prohibited(),
    writeFileSync: prohibited,
    writeFile: async () => prohibited(),
    deleteSync: prohibited,
    delete: async () => prohibited(),
    mkdirSync: prohibited,
    mkdir: async () => prohibited(),
    moveSync: prohibited,
    move: async () => prohibited(),
    copySync: prohibited,
    copy: async () => prohibited(),
    realpathSync: (path) => {
      if (!probe(path)) return path;
      return base.realpathSync(path);
    },
  };
  const host = new Proxy(base, {
    get(target, property) {
      const override = overrides[property as keyof FileSystemHost];
      if (override) return override;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { host, reads, used };
}
