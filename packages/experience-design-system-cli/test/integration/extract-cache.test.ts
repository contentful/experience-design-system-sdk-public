/**
 * Integration suite — extract_cache (Group 3).
 *
 * The extraction cache helpers are exercised independently of the hidden
 * wizard extraction subprocess.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openPipelineDb, storeExtractCache, lookupExtractCache } from '../../src/session/db.js';
import { createCacheFixture, SAMPLE_TWO_COMPONENTS } from './cache-harness.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
});

describe('cache integration: extract_cache', () => {
  it('extract_cache helper round-trips by (file_hash, cli_version)', async () => {
    const fix = await createCacheFixture(SAMPLE_TWO_COMPONENTS);
    cleanups.push(fix.cleanup);

    const db = openPipelineDb(fix.dbPath);
    try {
      storeExtractCache(db, 'src/Button.tsx', 'hash-1', 'v-test', SAMPLE_TWO_COMPONENTS);
      // Same file_hash + cli_version → hit.
      const hit = lookupExtractCache(db, 'hash-1', 'v-test');
      expect(hit).not.toBeNull();
      expect(hit!.components.length).toBe(SAMPLE_TWO_COMPONENTS.length);

      // Different file_hash → miss.
      expect(lookupExtractCache(db, 'hash-2', 'v-test')).toBeNull();
      // Different cli_version → miss (cli_version is part of the key).
      expect(lookupExtractCache(db, 'hash-1', 'v-other')).toBeNull();
    } finally {
      db.close();
    }
  });
});
