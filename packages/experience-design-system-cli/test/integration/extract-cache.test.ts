/**
 * Integration suite — extract_cache (Group 3).
 *
 * Contract today: `analyze extract` does NOT yet read or write extract_cache.
 * The helpers (storeExtractCache / lookupExtractCache) are forward-compatible
 * but no producer wires them. These tests pin that contract — they will fail
 * (in a deliberate way) the moment the extract command starts populating the
 * table, prompting an update to the integration suite alongside the wiring
 * change. Until then, the only meaningful exercise is the helper round-trip.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { openPipelineDb, storeExtractCache, lookupExtractCache } from '../../src/session/db.js';
import { readExtractCache, createCacheFixture, SAMPLE_TWO_COMPONENTS } from './cache-harness.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
});

async function makeProject(): Promise<{ projectDir: string; dbPath: string }> {
  const projectDir = await mkdtemp(join(tmpdir(), 'extract-integ-proj-'));
  const dbDir = await mkdtemp(join(tmpdir(), 'extract-integ-db-'));
  cleanups.push(() => rm(projectDir, { recursive: true, force: true }));
  cleanups.push(() => rm(dbDir, { recursive: true, force: true }));
  await mkdir(join(projectDir, 'src'), { recursive: true });
  await writeFile(
    join(projectDir, 'src/Button.tsx'),
    'export function Button({ label }: { label: string }) { return <button>{label}</button>; }\n',
    'utf8',
  );
  return { projectDir, dbPath: join(dbDir, 'pipeline.db') };
}

describe('cache integration: extract_cache', () => {
  it('19. analyze extract does NOT populate extract_cache (current contract)', async () => {
    // Sanity-check the help works first so we know the binary is reachable.
    const help = await runCli(['analyze', 'extract', '--help']);
    expect(help.code).toBe(0);

    const { projectDir, dbPath } = await makeProject();
    const r = await runCliWithEnv(['analyze', 'extract', '--project', projectDir], {
      ...process.env,
      EDS_PIPELINE_DB_PATH: dbPath,
      NODE_NO_WARNINGS: '1',
    });
    expect(r.code).toBe(0);
    expect(readExtractCache(dbPath)).toHaveLength(0);
  });

  it('20. extract_cache helper round-trips by (file_hash, cli_version)', async () => {
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
