import { observeGenerationMemoryBound } from '../../memory/generation-memory-mode.js';
import { currentImportWorkTiming } from '../../profiling/work-timing.js';
import { closeSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { BoundedResidentCache } from '../../memory/bounded-resident-cache.js';

export const INLINE_COMPONENT_BYTES = 8 * 1024 * 1024;
export const PREPROCESSING_BYTES = 8 * 1024 * 1024;
export const EVIDENCE_MAX_DEPTH = 128;
type StoredNode =
  | { kind: 'text'; chunks: Array<{ tree: number }> }
  | { kind: 'scalar'; value: string }
  | { kind: 'array' | 'object'; length?: number; entries: Array<[string, unknown]> };

export function checkEvidenceTraversal(value: unknown, signal?: AbortSignal, maximumBytes = Infinity): void {
  const ancestors = new WeakSet<object>();
  let bytes = 0;
  function visit(item: unknown, depth: number): void {
    signal?.throwIfAborted();
    if (depth > EVIDENCE_MAX_DEPTH) throw new Error('Evidence depth exceeds bounded traversal');
    if (typeof item === 'string') bytes += item.length * 2;
    else bytes += 16;
    if (
      bytes > maximumBytes &&
      !observeGenerationMemoryBound({
        bound: 'reservation',
        scope: 'estimate',
        operation: 'indexed-evidence',
        estimatedBytes: bytes,
        limitBytes: maximumBytes,
      })
    )
      throw new Error('Evidence preprocessing exceeds bounded allocation; use smaller inputs');
    if (item === null || typeof item !== 'object') return;
    if (ancestors.has(item)) throw new Error('Cyclic evidence input is unsupported');
    ancestors.add(item);
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      bytes += key.length * 2;
      const property = Object.getOwnPropertyDescriptor(item, key)!;
      if ('value' in property) visit(property.value, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
}

export class EvidencePreprocessing {
  private readonly path: string;
  private readonly db: DatabaseSync;
  private readonly insert: StatementSync;
  private readonly lookup: StatementSync;
  private readonly matching: StatementSync;
  private readonly insertTree: StatementSync;
  private readonly readTree: StatementSync;
  private readonly treeCache = new BoundedResidentCache<string>({
    maxBytes: 2 * 1024 * 1024,
    maxEntries: 512,
    idleMs: 60000,
  });
  constructor(
    directory: string,
    private readonly signal?: AbortSignal,
  ) {
    this.path = join(directory, '.evidence-preprocessing.sqlite');
    closeSync(openSync(this.path, 'wx', 0o600));
    this.db = new DatabaseSync(this.path);
    this.db.exec(`PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;
      CREATE TABLE derived (name TEXT, ordinal INTEGER, payload TEXT, selector TEXT, PRIMARY KEY(name,ordinal)) WITHOUT ROWID;
      CREATE INDEX derived_selector ON derived(name,selector,ordinal);
      CREATE TABLE trees (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      BEGIN;`);
    this.insert = this.db.prepare('INSERT INTO derived VALUES (?,?,?,?)');
    this.lookup = this.db.prepare('SELECT payload FROM derived WHERE name=? AND ordinal=?');
    this.matching = this.db.prepare(
      'SELECT payload FROM derived WHERE name=? AND selector IS ? ORDER BY ordinal LIMIT 2',
    );
    this.insertTree = this.db.prepare('INSERT INTO trees(payload) VALUES (?)');
    this.readTree = this.db.prepare('SELECT payload FROM trees WHERE id=?');
  }
  appendTree(name: string, ordinal: number, value: unknown): void {
    const ancestors = new WeakSet<object>();
    const save = (item: unknown, depth: number): unknown => {
      this.signal?.throwIfAborted();
      if (depth > EVIDENCE_MAX_DEPTH) throw new Error('Evidence depth exceeds bounded traversal');
      if (item === null || typeof item !== 'object') {
        if (typeof item !== 'string' || item.length <= 8192) return item;
        const chunks: Array<{ tree: number }> = [];
        for (let offset = 0; offset < item.length; offset += 8192)
          chunks.push(store({ kind: 'scalar', value: item.slice(offset, offset + 8192) }));
        return store({ kind: 'text', chunks });
      }
      if (ancestors.has(item)) throw new Error('Cyclic evidence input is unsupported');
      ancestors.add(item);
      try {
        const entries: Array<[string, unknown]> = [];
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue;
          const child = (item as Record<string, unknown>)[key];
          if (child !== undefined) entries.push([key, save(child, depth + 1)]);
        }
        return store({
          kind: Array.isArray(item) ? 'array' : 'object',
          length: Array.isArray(item) ? item.length : undefined,
          entries,
        });
      } finally {
        ancestors.delete(item);
      }
    };
    const store = (node: StoredNode) => {
      const payload = JSON.stringify(node);
      if (
        Buffer.byteLength(payload) > PREPROCESSING_BYTES &&
        !observeGenerationMemoryBound({
          bound: 'transport-bytes',
          scope: 'request',
          operation: 'indexed-evidence',
          observedBytes: Buffer.byteLength(payload),
          limitBytes: PREPROCESSING_BYTES,
        })
      )
        throw new Error('Derived evidence node exceeds bounded serialization');
      return { tree: Number(this.insertTree.run(payload).lastInsertRowid) };
    };
    this.append(name, ordinal, save(value, 0));
  }
  treeArray(name: string, length: number): unknown[] {
    const roots = this.array(name, length);
    const result: unknown[] = [];
    result.length = length;
    return new Proxy(result, {
      has: (target, key) =>
        (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length) || Reflect.has(target, key),
      get: (target, key, receiver) =>
        typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length
          ? this.decodeTree(roots[Number(key)])
          : Reflect.get(target, key, receiver),
    });
  }
  private decodeTree(value: unknown): unknown {
    this.signal?.throwIfAborted();
    if (value === null || typeof value !== 'object') return value;
    const id = String((value as { tree: number }).tree);
    const work = currentImportWorkTiming();
    work?.count('derivedTreeReads');
    let payload = this.treeCache.get(id);
    if (payload !== undefined) work?.count('derivedTreeCacheHits');
    if (payload === undefined) {
      const row = work
        ? work.measure('derivedLookupMs', () => this.readTree.get(Number(id)))
        : this.readTree.get(Number(id));
      if (!row) throw new Error('Missing derived evidence node');
      payload = String(row.payload);
      this.treeCache.set(id, payload, payload.length * 2);
    }
    const node = (
      work ? work.measure('derivedDecodeMs', () => JSON.parse(payload)) : JSON.parse(payload)
    ) as StoredNode;
    if (node.kind === 'scalar') return node.value;
    if (node.kind === 'text') return node.chunks.map((chunk) => this.decodeTree(chunk)).join('');
    const result: Record<string, unknown> | unknown[] = node.kind === 'array' ? new Array(node.length) : {};
    for (const [key, child] of node.entries)
      Object.defineProperty(result, key, {
        enumerable: true,
        configurable: true,
        get: () => this.decodeTree(child),
      });
    return result;
  }
  append(name: string, ordinal: number, value: unknown, selector?: string): void {
    this.signal?.throwIfAborted();
    checkEvidenceTraversal(value, this.signal, PREPROCESSING_BYTES);
    const payload = JSON.stringify(value);
    if (
      Buffer.byteLength(payload) > PREPROCESSING_BYTES &&
      !observeGenerationMemoryBound({
        bound: 'transport-bytes',
        scope: 'request',
        operation: 'indexed-evidence',
        observedBytes: Buffer.byteLength(payload),
        limitBytes: PREPROCESSING_BYTES,
      })
    )
      throw new Error('Derived evidence exceeds bounded serialization; use smaller inputs');
    this.insert.run(name, ordinal, payload, selector ?? null);
  }
  matchingFiles(name: string, selector: string | null | undefined): unknown[] {
    this.signal?.throwIfAborted();
    return this.matching.all(name, selector ?? null).map((row) => JSON.parse(String(row.payload)) as unknown);
  }
  array(name: string, length: number): unknown[] {
    const array: unknown[] = [];
    array.length = length;
    return new Proxy(array, {
      has: (target, key) =>
        (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length) || Reflect.has(target, key),
      get: (target, key, receiver) => {
        if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
          return Reflect.get(target, key, receiver);
        this.signal?.throwIfAborted();
        const row = this.lookup.get(name, Number(key));
        if (!row) throw new Error('Missing derived evidence entry');
        return JSON.parse(String(row.payload)) as unknown;
      },
    });
  }
  close(): void {
    this.treeCache.clear();
    try {
      this.db.close();
    } finally {
      rmSync(this.path, { force: true });
    }
  }
}
