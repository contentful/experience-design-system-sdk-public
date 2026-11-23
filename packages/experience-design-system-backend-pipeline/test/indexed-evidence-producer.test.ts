import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { StreamingEvidenceWriter } from '../src/source-evidence/indexed-evidence/stream-write.js';
import { EvidenceRecordIndex } from '../src/source-evidence/indexed-evidence/record-index.js';
import type { EvidenceValue } from '../src/source-evidence/indexed-evidence/types.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function snapshot(run: (writer: StreamingEvidenceWriter) => EvidenceValue, signal?: AbortSignal) {
  const directory = mkdtempSync(join(tmpdir(), 'evidence-producer-'));
  directories.push(directory);
  const index = new EvidenceRecordIndex(directory, 'create');
  const writer = new StreamingEvidenceWriter(directory, index, signal);
  let root: EvidenceValue;
  try {
    root = run(writer);
    index.publish();
  } finally {
    writer.close();
    index.close();
  }
  return { root, count: writer.recordCount, bytes: readFileSync(join(directory, 'records.jsonl')) };
}

it('preserves encoded object/array identity and physical record order when children are produced inside the iterator', () => {
  const input = {
    '2': ['one', { '\ud800': 'escaped' }],
    '8': false,
    normal: { nested: 'two' },
    __proto__: 'ignored literal field',
  };
  const complete = snapshot((writer) => writer.encode(input));
  const incremental = snapshot((writer) =>
    writer.encodeEntries(
      'object',
      (function* () {
        for (const [key, value] of Object.entries(input)) yield { key, value: writer.encode(value) };
      })(),
    ),
  );
  expect(incremental).toEqual(complete);
  const values = Array.from({ length: 400 }, (_, i) => ({ name: `node-${i}` }));
  expect(
    snapshot((writer) =>
      writer.encodeEntries(
        'array',
        (function* () {
          for (let i = 0; i < values.length; i++) yield { key: String(i), value: writer.encode(values[i]) };
        })(),
      ),
    ),
  ).toEqual(snapshot((writer) => writer.encode(values)));
});

it.each([0, 1, 8192, 8193, 32000])(
  'preserves text/scalar bytes across arbitrary chunk boundaries for %i units',
  (length) => {
    const value = 'a😀"\\\n\ud800'.repeat(10000).slice(0, length);
    const chunks = (function* () {
      for (let i = 0; i < value.length; i += 7) yield value.slice(i, i + 7);
    })();
    expect(snapshot((writer) => writer.encodeText(chunks))).toEqual(snapshot((writer) => writer.encode(value)));
  },
);

it('rejects duplicate, unordered integer and noncontiguous array keys without publishing a corrupted parent', () => {
  expect(() =>
    snapshot((writer) =>
      writer.encodeEntries('object', [
        { key: 'name', value: 1 },
        { key: 'name', value: 2 },
      ]),
    ),
  ).toThrow(/duplicate/i);
  expect(() =>
    snapshot((writer) =>
      writer.encodeEntries('object', [
        { key: 'name', value: 1 },
        { key: '1', value: 2 },
      ]),
    ),
  ).toThrow(/encounter order/i);
  expect(() => snapshot((writer) => writer.encodeEntries('array', [{ key: '1', value: 1 }]))).toThrow(/contiguous/i);
});

it('cancels incremental iteration and returns control to the producer cleanup', () => {
  const controller = new AbortController();
  let closed = false;
  const entries = (function* () {
    try {
      yield { key: '0', value: 1 };
      controller.abort(new Error('stop producer'));
      yield { key: '1', value: 2 };
    } finally {
      closed = true;
    }
  })();
  expect(() => snapshot((writer) => writer.encodeEntries('array', entries), controller.signal)).toThrow(
    'stop producer',
  );
  expect(closed).toBe(true);
});

it('bounds recursive producer depth and closes text iteration after cancellation', () => {
  expect(() =>
    snapshot((writer) => {
      function nested(depth: number): EvidenceValue {
        return writer.encodeEntries(
          'object',
          (function* () {
            yield { key: 'child', value: depth ? nested(depth - 1) : 1 };
          })(),
        );
      }
      return nested(160);
    }),
  ).toThrow(/depth exceeds bounded/);
  const controller = new AbortController();
  let closed = false;
  const chunks = (function* () {
    try {
      yield 'x'.repeat(8192);
      controller.abort(new Error('stop text'));
      yield 'next';
    } finally {
      closed = true;
    }
  })();
  expect(() => snapshot((writer) => writer.encodeText(chunks), controller.signal)).toThrow('stop text');
  expect(closed).toBe(true);
});

it('keeps incremental producer statement metadata fixed across many records', () => {
  const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
  try {
    snapshot((writer) => {
      let value: EvidenceValue = null;
      for (let i = 0; i < 1000; i++) value = writer.encodeEntries('object', [{ key: 'name', value: `Item${i}` }]);
      return value;
    });
    expect(prepare.mock.calls.length).toBeLessThan(20);
  } finally {
    prepare.mockRestore();
  }
});
