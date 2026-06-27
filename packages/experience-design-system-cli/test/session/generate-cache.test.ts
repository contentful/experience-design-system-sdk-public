import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, lookupCache, storeCache, getOrCreateSession } from '../../src/session/db.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

async function tmpDbPath(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'gen-cache-'));
  tempDirs.push(d);
  return join(d, 'pipeline.db');
}

describe('generation_cache with prompt_hash', () => {
  it('adds a prompt_hash column with default empty string', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const cols = db.prepare('PRAGMA table_info(generation_cache)').all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    const ph = cols.find((c) => c.name === 'prompt_hash');
    expect(ph).toBeDefined();
    db.close();
  });

  it('storeCache with promptHash and lookupCache with matching promptHash returns the entry', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
    storeCache(db, 'inputA', 'component', 'comp1', sessionId, false, 'promptX');
    const hit = lookupCache(db, 'inputA', 'component', 'comp1', 'promptX');
    expect(hit).not.toBeNull();
    expect(hit?.promptHash).toBe('promptX');
    db.close();
  });

  it('lookupCache returns null when promptHash differs', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
    storeCache(db, 'inputA', 'component', 'comp1', sessionId, false, 'promptX');
    expect(lookupCache(db, 'inputA', 'component', 'comp1', 'promptY')).toBeNull();
    db.close();
  });

  it('cache entries with different prompt_hash coexist', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
    storeCache(db, 'inputA', 'component', 'comp1', sessionId, false, 'promptX');
    storeCache(db, 'inputA', 'component', 'comp1', sessionId, true, 'promptY');
    const x = lookupCache(db, 'inputA', 'component', 'comp1', 'promptX');
    const y = lookupCache(db, 'inputA', 'component', 'comp1', 'promptY');
    expect(x?.humanEdited).toBe(false);
    expect(y?.humanEdited).toBe(true);
    db.close();
  });

  it('omitting promptHash defaults to empty-string lookup (backward compat)', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
    // Insert directly with prompt_hash = '' (simulates pre-migration row)
    db.prepare(
      `INSERT INTO generation_cache (input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at, prompt_hash)
       VALUES (?, 'component', ?, ?, 0, ?, ?, '')`,
    ).run('inputZ', 'compZ', sessionId, new Date().toISOString(), new Date().toISOString());
    // Default-arg lookup should match the empty prompt_hash
    const hit = lookupCache(db, 'inputZ', 'component', 'compZ');
    expect(hit).not.toBeNull();
    expect(hit?.promptHash).toBe('');
    db.close();
  });
});
