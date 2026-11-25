import { describe, expect, it, vi } from 'vitest';
import { getHeapStatistics } from 'node:v8';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admitParentAllocation,
  readTransportValue,
  writeTransportValue,
} from '../../src/source-analysis/isolation/transport.js';
vi.mock('node:v8', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:v8')>();
  return { ...original, getHeapStatistics: vi.fn(original.getHeapStatistics) };
});
import { defaultTransportLimits, measureTransportValue } from '../../src/source-analysis/isolation/transport.js';

describe('bounded source transport admission', () => {
  it('refuses parent heap pressure before graph enumeration and reserves enumeration headroom', () => {
    const statistics = getHeapStatistics();
    vi.mocked(getHeapStatistics).mockReturnValueOnce({
      ...statistics,
      used_heap_size: 100 * 1024 ** 2,
      heap_size_limit: 120 * 1024 ** 2,
    });
    expect(() => admitParentAllocation(1024, 'capture', 'request', defaultTransportLimits)).toThrowError(
      expect.objectContaining({ failure: expect.objectContaining({ reason: 'parent-pressure' }) }),
    );
    const rss = vi.spyOn(process.memoryUsage, 'rss').mockReturnValue(defaultTransportLimits.parentRssLimitBytes / 2);
    try {
      expect(() => admitParentAllocation(1024, 'capture', 'request', defaultTransportLimits)).toThrow();
    } finally {
      rss.mockRestore();
    }
  });
  it('admits small cyclic structured values without invoking toJSON', () => {
    const value: Record<string, unknown> = {
      optional: undefined,
      date: new Date(0),
      values: new Map([[1, Buffer.from('abc')]]),
    };
    value.self = value;
    expect(measureTransportValue(value, 'capture', 'request')).toBeGreaterThan(0);
  });

  it('rejects oversized strings before invoking an accessor or serializing', () => {
    let read = false;
    const value = {
      source: 'x'.repeat(4096),
      get secret() {
        read = true;
        return 'private';
      },
    };
    expect(() =>
      measureTransportValue(value, 'capture', 'request', {
        ...defaultTransportLimits,
        maxBytes: 1024,
        maxGraphBytes: 1024,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'SOURCE_ISOLATION_FAILURE',
        failure: expect.objectContaining({ reason: 'request-too-large' }),
      }),
    );
    expect(read).toBe(false);
  });

  it('rejects accessors without executing caller code', () => {
    let read = false;
    expect(() =>
      measureTransportValue(
        {
          get data() {
            read = true;
            return 1;
          },
        },
        'capture',
        'request',
      ),
    ).toThrowError(expect.objectContaining({ failure: expect.objectContaining({ reason: 'unsupported-value' }) }));
    expect(read).toBe(false);
  });

  it('refuses sparse arrays, excessive breadth and depth recoverably', () => {
    expect(() => measureTransportValue(new Array(1000000), 'capture', 'request')).toThrow();
    expect(() =>
      measureTransportValue([1, 2, 3], 'capture', 'request', { ...defaultTransportLimits, maxEntries: 2 }),
    ).toThrow();
    expect(() =>
      measureTransportValue({ a: { b: { c: 1 } } }, 'capture', 'request', { ...defaultTransportLimits, maxDepth: 1 }),
    ).toThrow();
  });
  it('measures native container storage without executing overwritten accessors', () => {
    let read = false;
    const value = new Map([[1, 2]]);
    Object.defineProperty(value, 'size', {
      get() {
        read = true;
        throw new Error('Accessor executed');
      },
    });
    expect(measureTransportValue(value, 'capture', 'request')).toBeGreaterThan(0);
    expect(read).toBe(false);
  });
  it('rejects typed views backed by shared storage and missing or excessive limits', () => {
    expect(() => measureTransportValue(new Uint8Array(new SharedArrayBuffer(16)), 'capture', 'request')).toThrowError(
      expect.objectContaining({ failure: expect.objectContaining({ reason: 'unsupported-value' }) }),
    );
    expect(() =>
      measureTransportValue({}, 'capture', 'request', {
        ...defaultTransportLimits,
        maxBytes: defaultTransportLimits.maxBytes + 1,
      }),
    ).toThrow('Invalid source transport limit');
    expect(() => measureTransportValue({}, 'capture', 'request', {} as typeof defaultTransportLimits)).toThrow(
      'Invalid source transport limit',
    );
  });
});

describe('operation-owned binary handles', () => {
  it('roundtrips values, cycles and binary bytes with an exact digest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bounded-transport-'));
    try {
      const value: Record<string, unknown> = {
        empty: undefined,
        bytes: Buffer.from([0, 255]),
        entries: new Map([[1, new Set(['x'])]]),
        date: new Date(0),
      };
      value.self = value;
      const handle = await writeTransportValue(directory, 'owner', 'request', value, 'capture');
      expect(handle.digest).toMatch(/^[a-f0-9]{64}$/);
      const loaded = (await readTransportValue(directory, 'owner', 'request', handle, 'capture')) as Record<
        string,
        unknown
      >;
      expect(loaded).toEqual(value);
      expect(loaded.self).toBe(loaded);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects foreign owners, roles, stale contents and response limits before hydration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bounded-transport-'));
    try {
      const handle = await writeTransportValue(directory, 'owner', 'result', { source: 'content' }, 'capture');
      await expect(readTransportValue(directory, 'foreign', 'result', handle, 'capture')).rejects.toMatchObject({
        failure: { reason: 'invalid-handle' },
      });
      await expect(readTransportValue(directory, 'owner', 'request', handle, 'capture')).rejects.toMatchObject({
        failure: { reason: 'invalid-handle' },
      });
      await expect(
        readTransportValue(directory, 'owner', 'result', handle, 'capture', {
          ...defaultTransportLimits,
          maxGraphBytes: 1,
        }),
      ).rejects.toMatchObject({ failure: { reason: 'result-too-large' } });
      await expect(
        readTransportValue(
          directory,
          'owner',
          'result',
          handle,
          'capture',
          { ...defaultTransportLimits, parentRssLimitBytes: 1 },
          true,
        ),
      ).rejects.toMatchObject({ failure: { reason: 'parent-pressure' } });
      await writeFile(join(directory, 'result.bin'), Buffer.alloc(handle.bytes));
      await expect(readTransportValue(directory, 'owner', 'result', handle, 'capture')).rejects.toMatchObject({
        failure: { reason: 'invalid-handle' },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked response instead of following a foreign artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bounded-transport-'));
    try {
      const handle = await writeTransportValue(directory, 'owner', 'result', 'content', 'capture');
      await rm(join(directory, 'result.bin'));
      await writeFile(join(directory, 'foreign.bin'), 'foreign');
      await symlink(join(directory, 'foreign.bin'), join(directory, 'result.bin'));
      await expect(readTransportValue(directory, 'owner', 'result', handle, 'capture')).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
