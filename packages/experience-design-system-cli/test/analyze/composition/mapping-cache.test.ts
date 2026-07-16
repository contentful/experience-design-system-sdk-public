import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readMappingCache, writeMappingCache } from '../../../src/analyze/composition/mapping-cache.js';
import type { InterchangeMap } from '../../../src/analyze/composition/interchange-schema.js';

const MAP: InterchangeMap = { version: 1, groups: { A: ['B', 'C'] } };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mapcache-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('mapping cache', () => {
  it('returns null on a miss', async () => {
    expect(await readMappingCache('deadbeef', { cacheDir: dir })).toBeNull();
  });

  it('round-trips a written map', async () => {
    await writeMappingCache('key1', MAP, { cacheDir: dir });
    const got = await readMappingCache('key1', { cacheDir: dir });
    expect(got).toEqual(MAP);
  });

  it('keys are independent', async () => {
    await writeMappingCache('key1', MAP, { cacheDir: dir });
    expect(await readMappingCache('key2', { cacheDir: dir })).toBeNull();
  });

  it('a corrupt cache file reads as a miss (does not throw)', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'key1.json'), '{ not json');
    expect(await readMappingCache('key1', { cacheDir: dir })).toBeNull();
  });

  it('a schema-invalid cached payload reads as a miss', async () => {
    const { writeFile } = await import('node:fs/promises');
    // Write an invalid payload under the exact key's file path.
    await writeFile(join(dir, 'k.json'), JSON.stringify({ version: 2, groups: {} }));
    expect(await readMappingCache('k', { cacheDir: dir })).toBeNull();
  });
});
