import { profileImportSync, type ImportWorkMetric } from '../../profiling/import-profile.js';
import { startImportWorkTiming, withImportWorkTiming, type ImportWorkTiming } from '../../profiling/work-timing.js';
import { createHash, type Hash } from 'node:crypto';
import { closeSync, ftruncateSync, openSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { EvidenceRecordIndex } from './record-index.js';
import type { EvidenceRecord, EvidenceValue } from './types.js';
import { EVIDENCE_MAX_DEPTH } from './preprocessing.js';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function stringParts(value: string, emit: (part: string) => void): void {
  emit('"');
  for (let start = 0; start < value.length; ) {
    let end = Math.min(value.length, start + 8192);
    if (
      end < value.length &&
      value.charCodeAt(end - 1) >= 0xd800 &&
      value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 &&
      value.charCodeAt(end) <= 0xdfff
    )
      end--;
    emit(JSON.stringify(value.slice(start, end)).slice(1, -1));
    start = end;
  }
  emit('"');
}

export class StreamingEvidenceWriter {
  private readonly scratch: DatabaseSync;
  private readonly path: string;
  private readonly fd: number;
  private sequence = 0;
  private readonly output = Buffer.allocUnsafe(65536);
  private pendingOutput = 0;
  private readonly ancestors = new WeakSet<object>();
  private depth = 0;
  private readonly rowStatement: StatementSync;
  private readonly producerInsert: StatementSync;
  private readonly producerKeys: StatementSync;
  private readonly producerFirst: StatementSync;
  private readonly removeFragments: StatementSync;
  private readonly removeProducerKeys: StatementSync;
  private work?: ImportWorkTiming;
  profile<T>(name: string, action: () => T): T {
    const work = startImportWorkTiming(name);
    if (!work) return profileImportSync(name, action);
    const previous = this.work;
    const initialRecords = this.recordCount;
    this.work = work;
    let status: 'success' | 'error' | 'cancelled' = 'success';
    try {
      return withImportWorkTiming(work, () => work.measure('traversalMs', action));
    } catch (error) {
      status = error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error';
      throw error;
    } finally {
      this.work = previous;
      work.count('recordCount', this.recordCount - initialRecords);
      work.end(status);
    }
  }
  private measure<T>(metric: ImportWorkMetric, action: () => T): T {
    return this.work ? this.work.measure(metric, action) : action();
  }
  private read(value: Record<string, unknown> | unknown[], key: string | number): unknown {
    this.work?.count('valueReads');
    return this.measure('valueAccessMs', () => (value as Record<string, unknown>)[key]);
  }
  private update(hash: Hash, value: string | Buffer, metric: 'recordHashMs' | 'logicalHashMs'): Hash {
    this.work?.count('hashUpdates');
    return this.measure(metric, () => hash.update(value));
  }
  bytes = 0;
  recordCount = 0;
  constructor(
    directory: string,
    private readonly index: EvidenceRecordIndex,
    private readonly signal?: AbortSignal,
    private readonly external?: {
      encode(value: unknown, writer: StreamingEvidenceWriter): EvidenceValue | undefined;
      accepts(id: string): boolean;
      normalized(value: unknown, path: string[]): unknown;
    },
  ) {
    this.path = join(directory, '.record-writing.sqlite');
    closeSync(openSync(this.path, 'wx', 0o600));
    this.scratch = new DatabaseSync(this.path);
    this.scratch.exec(`PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;
      CREATE TABLE fragments (parent INTEGER, ordinal INTEGER, key TEXT, value TEXT, digest TEXT,
        PRIMARY KEY(parent, ordinal)) WITHOUT ROWID;
      CREATE TABLE producer_keys (parent INTEGER, key TEXT, PRIMARY KEY(parent,key)) WITHOUT ROWID;
      CREATE TABLE runs (run INTEGER, ordinal INTEGER, key TEXT, digest TEXT,
        PRIMARY KEY(run, ordinal)) WITHOUT ROWID; BEGIN;`);
    this.rowStatement = this.scratch.prepare('SELECT key,value,digest FROM fragments WHERE parent=? ORDER BY ordinal');
    this.producerInsert = this.scratch.prepare('INSERT INTO fragments(parent,ordinal,key,value) VALUES (?,?,?,?)');
    this.producerKeys = this.scratch.prepare('INSERT OR IGNORE INTO producer_keys VALUES (?,?)');
    this.producerFirst = this.scratch.prepare('SELECT value FROM fragments WHERE parent=? AND ordinal=0');
    this.removeFragments = this.scratch.prepare('DELETE FROM fragments WHERE parent=?');
    this.removeProducerKeys = this.scratch.prepare('DELETE FROM producer_keys WHERE parent=?');
    try {
      this.fd = openSync(join(directory, 'records.jsonl'), 'wx', 0o600);
    } catch (error) {
      this.scratch.close();
      rmSync(this.path);
      throw error;
    }
  }
  flush(): void {
    this.signal?.throwIfAborted();
    this.flushOutput();
  }
  private flushOutput(): void {
    let written = 0;
    while (written < this.pendingOutput)
      written += this.measure('fileWriteMs', () =>
        writeSync(
          this.fd,
          this.output,
          written,
          this.pendingOutput - written,
          this.bytes - this.pendingOutput + written,
        ),
      );
    this.pendingOutput = 0;
  }
  private append(part: string, hash?: Hash): void {
    this.signal?.throwIfAborted();
    const buffer = this.measure('utf8EncodeMs', () => Buffer.from(part));
    if (hash) this.update(hash, buffer, 'recordHashMs');
    let consumed = 0;
    while (consumed < buffer.length) {
      const count = Math.min(this.output.length - this.pendingOutput, buffer.length - consumed);
      buffer.copy(this.output, this.pendingOutput, consumed, consumed + count);
      this.pendingOutput += count;
      this.bytes += count;
      consumed += count;
      if (this.pendingOutput === this.output.length) this.flushOutput();
    }
  }
  private rows(parent: number) {
    return this.rowStatement.iterate(parent);
  }
  private *recordRows(parent: number): Generator<{ key: string; value: string }> {
    for (const row of this.rows(parent)) yield { key: String(row.key), value: String(row.value) };
  }
  private bounded<T>(value: unknown, operation: () => T): T {
    if (this.depth > EVIDENCE_MAX_DEPTH) throw new Error('Evidence depth exceeds bounded traversal');
    const object = value !== null && typeof value === 'object';
    if (object && this.ancestors.has(value)) throw new Error('Cyclic evidence input is unsupported');
    if (object) this.ancestors.add(value);
    this.depth++;
    try {
      return operation();
    } finally {
      this.depth--;
      if (object) this.ancestors.delete(value);
    }
  }
  encode(value: unknown): EvidenceValue {
    return this.bounded(value, () => this.encodeValue(value));
  }
  private encodeValue(value: unknown): EvidenceValue {
    this.signal?.throwIfAborted();
    const external = this.external?.encode(value, this);
    if (external !== undefined) return external;
    let kind: EvidenceRecord['kind'];
    if (Array.isArray(value)) {
      kind = 'array';
      this.work?.count('encodedArrays');
    } else if (object(value)) {
      kind = 'object';
      this.work?.count('encodedObjects');
    } else if (typeof value === 'string' && value.length > 8192) kind = 'text';
    else return value as EvidenceValue;
    if (kind === 'text' && typeof value === 'string') {
      const text = value;
      function* chunks(): Generator<{ key: string; value: string }> {
        for (let i = 0; i < text.length; i += 8192)
          yield { key: String(i / 8192), value: JSON.stringify(text.slice(i, i + 8192)) };
      }
      return this.store(kind, Math.ceil(value.length / 8192), chunks());
    }
    const parent = ++this.sequence;
    let insert: ReturnType<DatabaseSync['prepare']> | undefined;
    let count = 0,
      pendingBytes = 0,
      spilled = false;
    let pending: Array<{ key: string; value: string }> = [];
    const add = (key: string, item: unknown): void => {
      const child = this.encode(item);
      const encoded = this.measure('jsonEncodeMs', () => JSON.stringify(child)) ?? 'null';
      const size = Buffer.byteLength(key) + Buffer.byteLength(encoded);
      if (!spilled && (pending.length === 64 || pendingBytes + size > 65536)) {
        insert = this.scratch.prepare('INSERT INTO fragments(parent, ordinal, key, value) VALUES (?, ?, ?, ?)');
        this.measure('sqliteWriteMs', () =>
          pending.forEach((row, ordinal) => insert!.run(parent, ordinal, row.key, row.value)),
        );
        this.work?.count('fragmentWrites', pending.length);
        pending = [];
        spilled = true;
      }
      if (spilled) {
        this.measure('sqliteWriteMs', () => insert!.run(parent, count, key, encoded));
        this.work?.count('fragmentWrites');
      } else {
        pending.push({ key, value: encoded });
        pendingBytes += size;
      }
      count++;
    };
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) add(String(i), this.read(value, i));
    else if (object(value))
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const item = this.read(value, key);
        if (item !== undefined) add(key, item);
      }

    const result = this.store(kind, count, spilled ? this.recordRows(parent) : pending);
    if (spilled) this.scratch.prepare('DELETE FROM fragments WHERE parent=?').run(parent);
    return result;
  }
  encodeEntries(kind: 'object' | 'array', entries: Iterable<{ key: string; value: EvidenceValue }>): EvidenceValue {
    return this.bounded(null, () => this.encodedEntries(kind, entries));
  }
  encodeText(chunks: Iterable<string>): EvidenceValue {
    const signal = this.signal;
    function* entries(): Generator<{ key: string; value: string }> {
      let pending = '',
        ordinal = 0;
      for (const chunk of chunks) {
        signal?.throwIfAborted();
        if (typeof chunk !== 'string') throw new Error('Expected source text chunk');
        for (let offset = 0; offset < chunk.length; ) {
          signal?.throwIfAborted();
          const size = Math.min(8192 - pending.length, chunk.length - offset);
          pending += chunk.slice(offset, offset + size);
          offset += size;
          if (pending.length === 8192) {
            yield { key: String(ordinal++), value: pending };
            pending = '';
          }
        }
      }
      if (pending.length) yield { key: String(ordinal), value: pending };
    }
    return this.bounded(null, () => this.encodedEntries('text', entries()));
  }
  private encodedEntries(
    kind: EvidenceRecord['kind'],
    entries: Iterable<{ key: string; value: EvidenceValue }>,
  ): EvidenceValue {
    this.signal?.throwIfAborted();
    const parent = ++this.sequence;
    let count = 0,
      lastInteger = -1,
      namedKey = false;
    try {
      for (const entry of entries) {
        this.signal?.throwIfAborted();
        if (typeof entry.key !== 'string' || entry.key.length > 32768)
          throw new Error('Encoded evidence key exceeds bounded metadata');
        if (kind !== 'object' && entry.key !== String(count)) throw new Error('Expected contiguous encoded array keys');
        if (kind === 'object') {
          const integer = /^(0|[1-9][0-9]*)$/.test(entry.key) && Number(entry.key) < 4294967295;
          if (integer && (namedKey || Number(entry.key) <= lastInteger))
            throw new Error('Expected JavaScript JSON encounter order');
          if (integer) lastInteger = Number(entry.key);
          else namedKey = true;
          if (!this.producerKeys.run(parent, JSON.stringify(entry.key)).changes)
            throw new Error('Duplicate encoded evidence key');
        }
        const value = entry.value;
        if (typeof value === 'string' && value.length > 8192) throw new Error('Large encoded text requires encodeText');
        if (value !== null && typeof value === 'object') {
          let fields = 0;
          for (const key in value) {
            if (!Object.hasOwn(value, key)) continue;
            if (++fields > 1 || key !== 'ref') throw new Error('Expected an encoded evidence reference');
          }
          if (
            fields !== 1 ||
            typeof value.ref !== 'string' ||
            !/^[a-f0-9]{64}$/.test(value.ref) ||
            (!this.index.get(value.ref) && !this.external?.accepts(value.ref))
          )
            throw new Error('Unknown encoded evidence reference');
        } else if (value !== null && !['string', 'boolean', 'number'].includes(typeof value)) {
          throw new Error('Expected an encoded evidence scalar');
        }
        if (kind === 'text' && typeof value !== 'string') throw new Error('Expected encoded text chunk');
        this.producerInsert.run(parent, count++, JSON.stringify(entry.key), JSON.stringify(value));
      }
      if (kind === 'text' && count < 2) {
        const row = this.producerFirst.get(parent);
        return row ? (JSON.parse(String(row.value)) as string) : '';
      }
      const rows = this.rows(parent);
      function* decodedKeys(): Generator<{ key: string; value: string }> {
        for (const row of rows) yield { key: JSON.parse(String(row.key)) as string, value: String(row.value) };
      }
      return this.store(kind, count, decodedKeys());
    } finally {
      this.removeFragments.run(parent);
      this.removeProducerKeys.run(parent);
    }
  }
  private store(
    kind: EvidenceRecord['kind'],
    count: number,
    entries: Iterable<{ key: unknown; value: unknown }>,
  ): EvidenceValue {
    const start = this.bytes;
    const hash = createHash('sha256');
    const emit = (part: string) => this.append(part, hash);
    emit(`{"kind":"${kind}","entries":${kind === 'object' ? '{' : '['}`);
    let ordinal = 0;
    for (const row of entries) {
      if (ordinal++) emit(',');
      if (kind === 'object') {
        stringParts(String(row.key), emit);
        emit(':');
      }
      emit(String(row.value));
    }
    emit(kind === 'object' ? '}}' : ']}');
    const id = this.measure('recordHashMs', () => hash.digest('hex'));
    const length = this.bytes - start;
    if (this.measure('indexLookupMs', () => this.index.get(id))) {
      this.work?.count('duplicateRecords');
      this.flushOutput();
      this.measure('fileWriteMs', () => ftruncateSync(this.fd, start));
      this.bytes = start;
    } else {
      this.measure('sqliteWriteMs', () => this.index.add(id, { offset: start, bytes: length, kind, count }));
      this.recordCount++;
      this.append('\n');
    }
    return { ref: id };
  }
  private sorted(parent: number): number {
    const insert = this.scratch.prepare('INSERT INTO runs VALUES (?, ?, ?, ?)');
    let firstRun = 0,
      previousRun = 0,
      runs = 0;
    let batch: Array<{ key: string; digest: string }> = [];
    let batchBytes = 0;
    const flush = (): void => {
      const run = ++this.sequence;
      if (!firstRun) firstRun = run;
      previousRun = run;
      runs++;
      batch.sort((a, b) => a.key.localeCompare(b.key));
      batch.forEach((row, ordinal) => insert.run(run, ordinal, row.key, row.digest));
      batch = [];
      batchBytes = 0;
    };
    for (const row of this.rows(parent)) {
      const size = Buffer.byteLength(String(row.key)) + 64;
      if (batch.length && batchBytes + size > 65536) flush();
      batch.push({ key: String(row.key), digest: String(row.digest) });
      batchBytes += size;
      if (batch.length === 256) flush();
    }
    if (batch.length || !runs) flush();
    while (runs > 1) {
      const levelFirst = this.sequence + 1;
      let outputRuns = 0;
      for (let left = firstRun; left <= previousRun; left += 2) {
        const output = ++this.sequence;
        outputRuns++;
        const query = this.scratch.prepare('SELECT key, digest FROM runs WHERE run=? ORDER BY ordinal');
        const a = query.iterate(left),
          b = this.scratch
            .prepare('SELECT key, digest FROM runs WHERE run=? ORDER BY ordinal')
            .iterate(left + 1 <= previousRun ? left + 1 : -1);
        let x = a.next(),
          y = b.next(),
          ordinal = 0;
        while (!x.done || !y.done) {
          this.signal?.throwIfAborted();
          if (y.done || (!x.done && String(x.value.key).localeCompare(String(y.value.key)) <= 0)) {
            insert.run(output, ordinal++, String(x.value!.key), String(x.value!.digest));
            x = a.next();
          } else {
            insert.run(output, ordinal++, String(y.value.key), String(y.value.digest));
            y = b.next();
          }
        }
        this.scratch.prepare('DELETE FROM runs WHERE run=? OR run=?').run(left, left + 1);
      }
      firstRun = levelFirst;
      previousRun = this.sequence;
      runs = outputRuns;
    }
    return firstRun;
  }
  normalized(value: unknown, path: string[] = []): string {
    const logical = this.external ? this.external.normalized(value, path) : value;
    return this.bounded(logical, () => this.normalizedValue(logical, path));
  }
  private normalizedValue(value: unknown, path: string[]): string {
    this.signal?.throwIfAborted();
    const hash = this.measure('logicalHashMs', () => createHash('sha256'));
    if (Array.isArray(value)) {
      this.update(hash, '[', 'logicalHashMs');
      for (let i = 0; i < value.length; i++) {
        if (i) this.update(hash, ',', 'logicalHashMs');
        this.update(
          hash,
          i in value ? JSON.stringify(this.normalized(this.read(value, i), [...path, String(i)])) : 'null',
          'logicalHashMs',
        );
      }
      return this.measure('logicalHashMs', () => this.update(hash, ']', 'logicalHashMs').digest('hex'));
    }
    const source =
      (['sourceInput', 'sharedSource', 'source'].includes(path[0] ?? '') && path.length === 1) ||
      (path.length === 5 &&
        path[3] === 'sourceClosure' &&
        path[4] === 'captureBinding' &&
        ((path[0] === 'components' && path[2] === 'componentFacts') ||
          (path[0] === 'componentEvidence' && path[2] === 'facts')));
    const timing =
      path.length === 4 &&
      ['sourceInput', 'sharedSource', 'source'].includes(path[0] ?? '') &&
      path.slice(-3).join('.') === 'inventory.bounds.used';
    if (object(value)) {
      const parent = ++this.sequence;
      let insert: ReturnType<DatabaseSync['prepare']> | undefined;
      let count = 0,
        pendingBytes = 0,
        spilled = false;
      let pending: Array<{ key: string; digest: string }> = [];
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const item = this.read(value, key);
        if (
          item !== undefined &&
          !(
            source &&
            ['captureId', 'captureDigest', 'envelopeId', 'envelopeDigest', 'sessionId', 'extractionStepId'].includes(
              key,
            )
          ) &&
          !(timing && key === 'discoveryMs')
        ) {
          const digest = this.normalized(item, [...path, key]);
          const size = Buffer.byteLength(key) + 64;
          if (!spilled && (pending.length === 256 || pendingBytes + size > 65536)) {
            insert = this.scratch.prepare('INSERT INTO fragments(parent, ordinal, key, digest) VALUES (?, ?, ?, ?)');
            pending.forEach((row, ordinal) => insert!.run(parent, ordinal, row.key, row.digest));
            pending = [];
            spilled = true;
          }
          if (spilled) insert!.run(parent, count, key, digest);
          else {
            pending.push({ key, digest });
            pendingBytes += size;
          }
          count++;
        }
      }
      const run = spilled ? this.measure('sortMs', () => this.sorted(parent)) : undefined;
      if (!spilled) this.measure('sortMs', () => pending.sort((a, b) => a.key.localeCompare(b.key)));
      this.update(hash, '[', 'logicalHashMs');
      let ordinal = 0;
      for (const row of run === undefined
        ? pending
        : this.scratch.prepare('SELECT key, digest FROM runs WHERE run=? ORDER BY ordinal').iterate(run)) {
        if (ordinal++) this.update(hash, ',', 'logicalHashMs');
        this.update(hash, '[', 'logicalHashMs');
        stringParts(String(row.key), (part) => this.update(hash, part, 'logicalHashMs'));
        this.update(hash, ',', 'logicalHashMs');
        this.update(hash, JSON.stringify(String(row.digest)), 'logicalHashMs');
        this.update(hash, ']', 'logicalHashMs');
      }
      if (run !== undefined) {
        this.scratch.prepare('DELETE FROM runs WHERE run=?').run(run);
        this.scratch.prepare('DELETE FROM fragments WHERE parent=?').run(parent);
      }
      return this.measure('logicalHashMs', () => this.update(hash, ']', 'logicalHashMs').digest('hex'));
    }
    if (typeof value === 'string' && path.length === 1 && path[0] === 'rendererReference') {
      try {
        const reference: unknown = JSON.parse(value);
        if (object(reference) && typeof reference.digest === 'string' && typeof reference.text === 'string') {
          const { retrievedAt: _time, ...content } = reference;
          return this.normalized(content);
        }
      } catch {}
    }
    if (typeof value === 'string') stringParts(value, (part) => this.update(hash, part, 'logicalHashMs'));
    else this.update(hash, JSON.stringify(value ?? null), 'logicalHashMs');
    return this.measure('logicalHashMs', () => hash.digest('hex'));
  }
  close(): void {
    try {
      try {
        this.flushOutput();
      } finally {
        closeSync(this.fd);
      }
    } finally {
      this.scratch.close();
      rmSync(this.path);
      rmSync(this.path + '-journal', { force: true });
    }
  }
}
