import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getOrCreateSession, loadRawComponents, openPipelineDb, storeRawComponents } from '../../src/session/db.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cache-table-removal-'));
  tempDirs.push(dir);
  return join(dir, 'pipeline.db');
}

const CACHE_TABLES = ['generation_cache', 'extract_cache', 'composition_cache', 'select_cache'] as const;

function listTables(dbPath: string): string[] {
  const db = new DatabaseSync(dbPath);
  try {
    return (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
  } finally {
    db.close();
  }
}

function listIndexes(dbPath: string): string[] {
  const db = new DatabaseSync(dbPath);
  try {
    return (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
  } finally {
    db.close();
  }
}

function addLegacyCacheTables(dbPath: string, sessionId: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS generation_cache (
        input_hash        TEXT NOT NULL,
        entity_type       TEXT NOT NULL CHECK (entity_type IN ('component', 'token_set', 'token_mapping')),
        entity_id         TEXT NOT NULL,
        source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        human_edited      INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        prompt_hash       TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (input_hash, prompt_hash, entity_type, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_generation_cache_entity ON generation_cache(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_generation_cache_session ON generation_cache(source_session_id);
      CREATE TABLE IF NOT EXISTS extract_cache (
        file_path TEXT NOT NULL, file_hash TEXT NOT NULL, cli_version TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, components_json TEXT NOT NULL,
        PRIMARY KEY (file_hash, cli_version)
      );
      CREATE INDEX IF NOT EXISTS idx_extract_cache_file ON extract_cache(file_path);
      CREATE TABLE IF NOT EXISTS composition_cache (
        input_hash TEXT NOT NULL, cli_version TEXT NOT NULL, agent_output TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (input_hash, cli_version)
      );
      CREATE TABLE IF NOT EXISTS select_cache (
        component_hash TEXT NOT NULL, prompt_hash TEXT NOT NULL, cli_version TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')), reason TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (component_hash, prompt_hash, cli_version)
      );
    `);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO generation_cache (input_hash, entity_type, entity_id, source_session_id, created_at, updated_at, prompt_hash)
       VALUES ('h', 'component', 'c1', ?, ?, ?, 'p')`,
    ).run(sessionId, now, now);
    db.prepare(`INSERT INTO extract_cache VALUES ('a.tsx', 'fh', 'v1', ?, ?, '[]')`).run(now, now);
    db.prepare(`INSERT INTO composition_cache VALUES ('ih', 'v1', 'out', ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO select_cache VALUES ('ch', 'ph', 'v1', 'accepted', NULL, ?, ?)`).run(now, now);
  } finally {
    db.close();
  }
}

async function seedSession(dbPath: string): Promise<string> {
  const db = openPipelineDb(dbPath);
  try {
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [
      {
        name: 'Button',
        source: 'src/Button.tsx',
        framework: 'react',
        props: [{ name: 'label', type: 'string', required: true }],
        slots: [],
      },
    ]);
    return sessionId;
  } finally {
    db.close();
  }
}

describe('openPipelineDb cache table removal', () => {
  it('creates none of the cache tables on a fresh database', async () => {
    const dbPath = await tempDbPath();

    openPipelineDb(dbPath).close();

    const tables = listTables(dbPath);
    for (const table of CACHE_TABLES) expect(tables).not.toContain(table);
  });

  it('drops every cache table from a database that still has them', async () => {
    const dbPath = await tempDbPath();
    const sessionId = await seedSession(dbPath);
    addLegacyCacheTables(dbPath, sessionId);
    expect(listTables(dbPath)).toEqual(expect.arrayContaining([...CACHE_TABLES]));

    openPipelineDb(dbPath).close();

    const tables = listTables(dbPath);
    for (const table of CACHE_TABLES) expect(tables).not.toContain(table);
  });

  it('drops the cache indexes along with their tables', async () => {
    const dbPath = await tempDbPath();
    const sessionId = await seedSession(dbPath);
    addLegacyCacheTables(dbPath, sessionId);

    openPipelineDb(dbPath).close();

    const indexes = listIndexes(dbPath);
    expect(indexes.filter((name) => name.includes('cache'))).toEqual([]);
  });

  it('keeps sessions, components and their props when the cache tables are dropped', async () => {
    const dbPath = await tempDbPath();
    const sessionId = await seedSession(dbPath);
    addLegacyCacheTables(dbPath, sessionId);

    const db = openPipelineDb(dbPath);
    try {
      const components = loadRawComponents(db, sessionId);
      expect(components.map((c) => c.name)).toEqual(['Button']);
      expect(components[0]?.props.map((p) => p.name)).toEqual(['label']);
      const sessions = db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>;
      expect(sessions.map((s) => s.id)).toContain(sessionId);
    } finally {
      db.close();
    }
  });

  it('is idempotent across repeated opens', async () => {
    const dbPath = await tempDbPath();
    const sessionId = await seedSession(dbPath);
    addLegacyCacheTables(dbPath, sessionId);

    openPipelineDb(dbPath).close();
    const afterFirst = listTables(dbPath);
    openPipelineDb(dbPath).close();
    openPipelineDb(dbPath).close();

    expect(listTables(dbPath)).toEqual(afterFirst);
  });

  it('drops a cache table even when only some of them exist', async () => {
    const dbPath = await tempDbPath();
    await seedSession(dbPath);
    const raw = new DatabaseSync(dbPath);
    raw.exec(`CREATE TABLE select_cache (component_hash TEXT NOT NULL, PRIMARY KEY (component_hash))`);
    raw.close();

    openPipelineDb(dbPath).close();

    expect(listTables(dbPath)).not.toContain('select_cache');
  });
});
