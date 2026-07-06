import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, storeSelectCache, lookupSelectCache } from '../../src/session/db.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

async function tmpDbPath(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'select-cache-'));
  tempDirs.push(d);
  return join(d, 'pipeline.db');
}

describe('select_cache', () => {
  it('creates the select_cache table with the expected columns', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const cols = db.prepare('PRAGMA table_info(select_cache)').all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    for (const n of [
      'component_hash',
      'prompt_hash',
      'cli_version',
      'decision',
      'reason',
      'created_at',
      'updated_at',
    ]) {
      expect(names.has(n)).toBe(true);
    }
    db.close();
  });

  it('round-trips storeSelectCache + lookupSelectCache', async () => {
    const db = openPipelineDb(await tmpDbPath());
    storeSelectCache(db, 'comp1', 'prompt1', 'v1', 'accepted', null);
    const hit = lookupSelectCache(db, 'comp1', 'prompt1', 'v1');
    expect(hit).not.toBeNull();
    expect(hit?.decision).toBe('accepted');
    expect(hit?.reason).toBeNull();
    db.close();
  });

  it('stores reason for rejected decisions', async () => {
    const db = openPipelineDb(await tmpDbPath());
    storeSelectCache(db, 'compR', 'p1', 'v1', 'rejected', 'pure context provider');
    const hit = lookupSelectCache(db, 'compR', 'p1', 'v1');
    expect(hit?.decision).toBe('rejected');
    expect(hit?.reason).toBe('pure context provider');
    db.close();
  });

  it('does not match across different prompt_hash', async () => {
    const db = openPipelineDb(await tmpDbPath());
    storeSelectCache(db, 'c1', 'promptA', 'v1', 'accepted', null);
    expect(lookupSelectCache(db, 'c1', 'promptA', 'v1')).not.toBeNull();
    expect(lookupSelectCache(db, 'c1', 'promptB', 'v1')).toBeNull();
    db.close();
  });

  it('does not match across different cli_version', async () => {
    const db = openPipelineDb(await tmpDbPath());
    storeSelectCache(db, 'c1', 'p1', 'v-old', 'accepted', null);
    expect(lookupSelectCache(db, 'c1', 'p1', 'v-old')).not.toBeNull();
    expect(lookupSelectCache(db, 'c1', 'p1', 'v-new')).toBeNull();
    db.close();
  });

  it('upserts on conflict (re-storing updates the row)', async () => {
    const db = openPipelineDb(await tmpDbPath());
    storeSelectCache(db, 'c1', 'p1', 'v1', 'accepted', null);
    storeSelectCache(db, 'c1', 'p1', 'v1', 'rejected', 'changed my mind');
    const hit = lookupSelectCache(db, 'c1', 'p1', 'v1');
    expect(hit?.decision).toBe('rejected');
    expect(hit?.reason).toBe('changed my mind');
    db.close();
  });
});
