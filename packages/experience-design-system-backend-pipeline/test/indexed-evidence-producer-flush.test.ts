import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { EvidenceRecordIndex } from '../src/source-evidence/indexed-evidence/record-index.js';
import { streamEvidenceEntries } from '../src/source-evidence/indexed-evidence/stream-record.js';
import { StreamingEvidenceWriter } from '../src/source-evidence/indexed-evidence/stream-write.js';
import type { EvidenceValue } from '../src/source-evidence/indexed-evidence/types.js';

const cleanups: Array<() => void> = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);
function fixture(signal?: AbortSignal) {
  const directory = mkdtempSync(join(tmpdir(), 'producer-flush-'));
  const index = new EvidenceRecordIndex(directory, 'create');
  const writer = new StreamingEvidenceWriter(directory, index, signal);
  const path = join(directory, 'records.jsonl');
  const fd = openSync(path, 'r+');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    closeSync(fd);
    try {
      writer.close();
    } finally {
      index.close();
    }
  };
  cleanups.push(() => {
    try {
      close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  function location(value: EvidenceValue) {
    if (!value || typeof value !== 'object') throw new Error('Expected encoded record');
    const descriptor = index.get(value.ref);
    if (!descriptor) throw new Error('Missing indexed record');
    return { id: value.ref, descriptor };
  }
  return { directory, path, fd, index, writer, close, location };
}

it('authenticates exact buffered text after flush while its index remains unpublished', () => {
  const f = fixture();
  const text = 'x'.repeat(20000);
  const encoded = f.writer.encodeText([text.slice(0, 7), text.slice(7)]);
  const { id, descriptor } = f.location(encoded);
  expect(descriptor.offset + descriptor.bytes).toBeGreaterThan(fstatSync(f.fd).size);
  expect(() => [...streamEvidenceEntries(f.fd, id, descriptor)]).toThrow('Incomplete evidence record');
  const observer = new EvidenceRecordIndex(f.directory, 'read');
  try {
    expect(observer.get(id)).toBeUndefined();
    f.writer.flush();
    expect(fstatSync(f.fd).size).toBe(f.writer.bytes);
    expect([...streamEvidenceEntries(f.fd, id, descriptor)].map(({ value }) => value).join('')).toBe(text);
    const original = readFileSync(f.path).subarray(descriptor.offset, descriptor.offset + descriptor.bytes);
    expect(createHash('sha256').update(original).digest('hex')).toBe(id);
    expect(observer.get(id)).toBeUndefined();
    expect(existsSync(join(f.directory, 'manifest.json'))).toBe(false);
    f.index.publish();
    expect(observer.get(id)).toEqual(descriptor);
  } finally {
    observer.close();
  }
});

it('preserves complete native bytes, IDs and ordering through append, repeated flush, deduplication and finalization', () => {
  const snapshot = (flush: boolean) => {
    const f = fixture();
    const text = 'a😀"\\\n\ud800'.repeat(3000);
    const first = f.writer.encodeText([text.slice(0, 8191), text.slice(8191)]);
    if (flush) {
      f.writer.flush();
      const bytes = readFileSync(f.path);
      f.writer.flush();
      expect(readFileSync(f.path)).toEqual(bytes);
    }
    const next = f.writer.encode([{ name: 'Example' }, 'next']);
    if (flush) f.writer.flush();
    expect(f.writer.encodeText([text])).toEqual(first);
    const root = f.writer.encodeEntries('array', [
      { key: '0', value: first },
      { key: '1', value: next },
    ]);
    if (flush) {
      f.writer.flush();
      const { id, descriptor } = f.location(first);
      expect([...streamEvidenceEntries(f.fd, id, descriptor)].map(({ value }) => value).join('')).toBe(text);
    }
    const locations = [first, next, root].map((value) => f.location(value));
    const count = f.writer.recordCount;
    const size = f.writer.bytes;
    f.index.publish();
    f.close();
    return { first, next, root, locations, count, size, bytes: readFileSync(f.path) };
  };
  expect(snapshot(true)).toEqual(snapshot(false));
});

it('checks cancellation before writing buffered bytes without publishing the index', () => {
  const controller = new AbortController();
  const f = fixture(controller.signal);
  const encoded = f.writer.encodeText(['x'.repeat(20000)]);
  const { id } = f.location(encoded);
  const before = { size: fstatSync(f.fd).size, bytes: f.writer.bytes, count: f.writer.recordCount };
  const reason = new Error('Stop pending flush');
  controller.abort(reason);
  expect(() => f.writer.flush()).toThrow(reason);
  expect({ size: fstatSync(f.fd).size, bytes: f.writer.bytes, count: f.writer.recordCount }).toEqual(before);
  const observer = new EvidenceRecordIndex(f.directory, 'read');
  try {
    expect(observer.get(id)).toBeUndefined();
  } finally {
    observer.close();
  }
});

it('keeps empty flush appendable and rejects changed original bytes after a populated flush', () => {
  const f = fixture();
  f.writer.flush();
  f.writer.flush();
  expect(fstatSync(f.fd).size).toBe(0);
  expect(f.writer.recordCount).toBe(0);
  const { id, descriptor } = f.location(f.writer.encodeText(['x'.repeat(20000)]));
  f.writer.flush();
  expect([...streamEvidenceEntries(f.fd, id, descriptor)]).toHaveLength(3);
  const bytes = readFileSync(f.path);
  const contentOffset = bytes.indexOf(Buffer.from('xxxxx'));
  expect(contentOffset).toBeGreaterThanOrEqual(0);
  writeSync(f.fd, Buffer.from('y'), 0, 1, contentOffset);
  expect(() => [...streamEvidenceEntries(f.fd, id, descriptor)]).toThrow('Changed evidence record');
});
