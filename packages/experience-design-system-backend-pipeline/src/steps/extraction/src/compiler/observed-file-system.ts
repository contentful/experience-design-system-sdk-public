import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, opendirSync, readSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project, type FileSystemHost } from 'ts-morph';
import * as morph from 'ts-morph';
import { ImportMemoryCapacityError } from '../../../../memory/evidence-worker-capacity.js';
import type { CompilerReadReceipt } from '../candidates/types.js';

const FileNotFoundError = (morph as typeof morph & { FileNotFoundError: new (path: string) => Error })
  .FileNotFoundError;

export const COMPILER_READ_LIMITS = {
  maxCompilerReads: 4096,
  maxCompilerFileBytes: 4 * 1024 * 1024,
  maxCompilerBytes: 64 * 1024 * 1024,
  maxCompilerProbes: 50_000,
  maxCompilerDirectoryEntries: 10_000,
};

const MAX_REPLAY_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_REPLAY_OPERATIONS = 131_072;
type ObservedOperation = { method: string; path: string; value?: unknown; error?: unknown };
export interface CompilerFileSystemSnapshot {
  readonly operations: readonly ObservedOperation[];
  readonly metadataBytes: number;
}
export class CompilerSnapshotError extends Error {
  readonly code = 'compiler-snapshot-unavailable';
  constructor(message: string) {
    super(message);
    this.name = 'CompilerSnapshotError';
  }
}

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
  let recording: ObservedOperation[] | undefined;
  let recordedMetadataBytes = 0;
  let totalReplayMetadataBytes = 0;
  let totalReplayOperations = 0;
  let replay: { snapshot: CompilerFileSystemSnapshot; index: number } | undefined;
  let snapshotFailure: Error | undefined;
  const failSnapshot = (message: string, capacity = false): never => {
    snapshotFailure = capacity
      ? new ImportMemoryCapacityError('reservation-too-large', MAX_REPLAY_METADATA_BYTES, process.memoryUsage.rss())
      : new CompilerSnapshotError(message);
    if (capacity) snapshotFailure.message = message;
    throw snapshotFailure;
  };
  const observeOperation = (method: string, path: string, action: () => unknown): unknown => {
    if ((recording || replay) && snapshotFailure) throw snapshotFailure;
    if (replay) {
      const operation = replay.snapshot.operations[replay.index++];
      if (!operation || operation.method !== method || operation.path !== path)
        return failSnapshot('Compiler snapshot replay operation mismatch');
      if ('error' in operation) throw operation.error;
      return Array.isArray(operation.value) ? operation.value.map((entry) => ({ ...entry })) : operation.value;
    }
    if (!recording) return action();
    const operation: ObservedOperation = { method, path };
    try {
      operation.value = action();
    } catch (error) {
      operation.error = error;
    }
    let bytes = 256 + path.length * 2;
    if (operation.error instanceof Error)
      bytes += (operation.error.message.length + (operation.error.stack?.length ?? 0)) * 2;
    if (method === 'readDirSync' && Array.isArray(operation.value))
      for (const entry of operation.value as ReturnType<FileSystemHost['readDirSync']>)
        bytes += 64 + entry.name.length * 2;
    if (totalReplayOperations >= MAX_REPLAY_OPERATIONS || totalReplayMetadataBytes + bytes > MAX_REPLAY_METADATA_BYTES)
      return failSnapshot('Compiler snapshot replay metadata exceeds declared capacity', true);
    totalReplayOperations++;
    totalReplayMetadataBytes += bytes;
    recordedMetadataBytes += bytes;
    const stored = { ...operation };
    if (Array.isArray(operation.value))
      stored.value = Object.freeze(operation.value.map((entry) => Object.freeze({ ...entry })));
    if (operation.error instanceof Error) {
      const copy = new Error(operation.error.message);
      Object.setPrototypeOf(copy, Object.getPrototypeOf(operation.error));
      for (const key of Object.getOwnPropertyNames(operation.error))
        Object.defineProperty(copy, key, {
          value: Reflect.get(operation.error, key),
          enumerable: Object.getOwnPropertyDescriptor(operation.error, key)!.enumerable,
        });
      stored.error = Object.freeze(copy);
    }
    recording.push(Object.freeze(stored));
    if ('error' in operation) throw operation.error;
    return operation.value;
  };
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
      if (override) {
        if (
          ['readFileSync', 'readDirSync', 'fileExistsSync', 'directoryExistsSync', 'realpathSync'].includes(
            String(property),
          )
        )
          return (path: string) =>
            observeOperation(String(property), path, () => (override as (path: string) => unknown)(path));
        return override;
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    host,
    reads,
    used,
    captureSnapshot<T>(action: () => T): { value: T; snapshot: CompilerFileSystemSnapshot } {
      if (recording || replay) throw new CompilerSnapshotError('Compiler snapshot phases cannot overlap');
      recording = [];
      recordedMetadataBytes = 0;
      snapshotFailure = undefined;
      try {
        const value = action();
        if (snapshotFailure) throw snapshotFailure;
        return {
          value,
          snapshot: Object.freeze({ operations: Object.freeze(recording), metadataBytes: recordedMetadataBytes }),
        };
      } finally {
        recording = undefined;
      }
    },
    replaySnapshot<T>(snapshot: CompilerFileSystemSnapshot, action: () => T): T {
      if (recording || replay) throw new CompilerSnapshotError('Compiler snapshot phases cannot overlap');
      replay = { snapshot, index: 0 };
      snapshotFailure = undefined;
      try {
        const value = action();
        if (snapshotFailure) throw snapshotFailure;
        if (replay.index !== snapshot.operations.length)
          throw new CompilerSnapshotError('Compiler snapshot replay is incomplete');
        return value;
      } finally {
        replay = undefined;
      }
    },
  };
}
