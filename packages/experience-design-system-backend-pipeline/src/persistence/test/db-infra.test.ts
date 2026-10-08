import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPipelineDbPath, openPipelineDb } from '../session/db.js';
import { configRoot } from '../session/config-root.js';

describe('openPipelineDb + schema', () => {
  let dbDir: string;
  const prevEdsHome = process.env['EDS_HOME'];
  const prevDbPath = process.env['EDS_PIPELINE_DB_PATH'];

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'pipeline-db-'));
    process.env['EDS_HOME'] = dbDir;
    delete process.env['EDS_PIPELINE_DB_PATH'];
  });

  afterEach(() => {
    rmSync(dbDir, { recursive: true, force: true });
    if (prevEdsHome === undefined) delete process.env['EDS_HOME'];
    else process.env['EDS_HOME'] = prevEdsHome;
    if (prevDbPath === undefined) delete process.env['EDS_PIPELINE_DB_PATH'];
    else process.env['EDS_PIPELINE_DB_PATH'] = prevDbPath;
  });

  it('resolves db path under configRoot by default', () => {
    expect(getPipelineDbPath()).toBe(join(configRoot(), 'pipeline.db'));
  });

  it('honors EDS_PIPELINE_DB_PATH override', () => {
    process.env['EDS_PIPELINE_DB_PATH'] = '/tmp/override.db';
    expect(getPipelineDbPath()).toBe('/tmp/override.db');
  });

  it('creates a fresh db with the expected tables', () => {
    const db = openPipelineDb(join(dbDir, 'pipeline.db'));
    try {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string;
      }>;
      const names = rows.map((r) => r.name);
      expect(names).toContain('sessions');
      expect(names).toContain('steps');
      expect(names).toContain('raw_components');
      expect(names).toContain('raw_props');
      expect(names).toContain('raw_slots');
      expect(names).toContain('generation_cache');
      expect(names).toContain('composition_cache');
      expect(names).toContain('select_cache');
      expect(names).toContain('extract_cache');
    } finally {
      db.close();
    }
  });

  it('enables WAL journaling', () => {
    const db = openPipelineDb(join(dbDir, 'pipeline.db'));
    try {
      const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(row.journal_mode.toLowerCase()).toBe('wal');
    } finally {
      db.close();
    }
  });
});
