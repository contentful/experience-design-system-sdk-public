import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, lookupCompositionCache, storeCompositionCache } from '../../../src/session/db.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
});

async function openDb() {
  const dir = await mkdtemp(join(tmpdir(), 'composition-cache-db-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return openPipelineDb(join(dir, 'pipeline.db'));
}

describe('composition_cache (pipeline DB)', () => {
  it('returns null on a miss', async () => {
    const db = await openDb();
    expect(lookupCompositionCache(db, 'deadbeef', 'v1')).toBeNull();
  });

  it('round-trips stored agent output', async () => {
    const db = await openDb();
    storeCompositionCache(db, 'key1', 'v1', 'export default (ctx) => []');
    expect(lookupCompositionCache(db, 'key1', 'v1')).toBe('export default (ctx) => []');
  });

  it('is scoped by cli_version', async () => {
    const db = await openDb();
    storeCompositionCache(db, 'key1', 'v1', 'old');
    expect(lookupCompositionCache(db, 'key1', 'v2')).toBeNull();
    storeCompositionCache(db, 'key1', 'v2', 'new');
    expect(lookupCompositionCache(db, 'key1', 'v1')).toBe('old');
    expect(lookupCompositionCache(db, 'key1', 'v2')).toBe('new');
  });

  it('upserts on a repeat write for the same key', async () => {
    const db = await openDb();
    storeCompositionCache(db, 'key1', 'v1', 'first');
    storeCompositionCache(db, 'key1', 'v1', 'second');
    expect(lookupCompositionCache(db, 'key1', 'v1')).toBe('second');
  });

  it('keys are independent', async () => {
    const db = await openDb();
    storeCompositionCache(db, 'key1', 'v1', 'a');
    expect(lookupCompositionCache(db, 'key2', 'v1')).toBeNull();
  });
});
