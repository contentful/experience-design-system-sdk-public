import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findLatestSessionForCommand, openPipelineDb } from '../src/session/repositories/db.js';
import type { CommandName } from '../src/session/repositories/db.js';

const CLEANUP_MIGRATION = 'prune_obsolete_incomplete_step_commands_v1';
const PRIOR_MIGRATION = 'v1_import_and_reviews';

const PUBLIC_COMMANDS = [
  'analyze extract',
  'analyze select',
  'generate components',
  'generate tokens',
  'apply',
  'print components',
  'print tokens',
  'map tokens',
  'fetch existing entities',
  'import',
] as const satisfies readonly CommandName[];

const OBSOLETE_COMMANDS = [
  'analyze select',
  'print components',
  'print tokens',
  'fetch existing entities',
] as const satisfies readonly CommandName[];

const RETAINED_WORKFLOW_COMMANDS = [
  'analyze extract',
  'generate components',
  'generate tokens',
  'map tokens',
  'apply',
  'import',
] as const satisfies readonly CommandName[];

const CLEANUP_STATUSES = ['pending', 'failed', 'interrupted'] as const;
const ALL_STATUSES = [...CLEANUP_STATUSES, 'complete'] as const;

describe('historical command cleanup migration', () => {
  let dbDir: string;
  let dbPath: string;
  let rowSequence: number;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'pipeline-history-'));
    dbPath = join(dbDir, 'pipeline.db');
    rowSequence = 0;

    const db = openPipelineDb(dbPath);
    db.prepare('DELETE FROM migrations WHERE name = ?').run(CLEANUP_MIGRATION);
    db.prepare('INSERT OR IGNORE INTO migrations (name, applied_at) VALUES (?, ?)').run(
      PRIOR_MIGRATION,
      '2024-01-01T00:00:00.000Z',
    );
    db.close();
  });

  afterEach(() => {
    rmSync(dbDir, { recursive: true, force: true });
  });

  it('removes only obsolete incomplete steps and preserves public completed history and unrelated data', () => {
    const db = openPipelineDb(dbPath);
    db.prepare('DELETE FROM migrations WHERE name = ?').run(CLEANUP_MIGRATION);

    for (const command of OBSOLETE_COMMANDS) {
      for (const status of CLEANUP_STATUSES) addStep(db, command, status);
    }

    for (const command of PUBLIC_COMMANDS) addStep(db, command, 'complete');
    addStep(db, 'print tokens', 'complete', '2026-12-01T00:00:00.000Z');

    for (const command of RETAINED_WORKFLOW_COMMANDS) {
      for (const status of ALL_STATUSES) addStep(db, command, status);
    }

    addStep(db, 'analyze select', 'complete');
    addStep(db, 'print components', 'running');
    addStep(db, 'generate refine', 'interrupted');
    addStep(db, 'unrecognized command', 'unrecognized-status');

    const sessionId = addStep(db, 'component-data-session', 'pending');
    db.prepare(
      `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, description)
       VALUES (?, 'component-1', 'Card', 'src/Card.tsx', 'react', '2026-01-01T00:00:00.000Z', 'saved component')`,
    ).run(sessionId);
    db.prepare(`INSERT INTO raw_token_groups (session_id, path, description) VALUES (?, 'colors', 'saved group')`).run(
      sessionId,
    );
    db.prepare(
      `INSERT INTO raw_tokens (session_id, path, type, value, description)
       VALUES (?, 'colors.brand', 'color', '"#123456"', 'saved token')`,
    ).run(sessionId);

    const runsPath = join(dbDir, 'runs.json');
    const reviewPath = join(dbDir, 'reviews', 'current-review-state.json');
    const runsText = '{"version":3,"runs":[{"id":"run-1"}]}';
    const reviewText = '{"components":[{"id":"component-1","status":"accepted"}]}';
    mkdirSync(join(dbDir, 'reviews'), { recursive: true });
    writeFileSync(runsPath, runsText);
    writeFileSync(reviewPath, reviewText);

    const rowsBefore = readSteps(db);
    const sessionCountBefore = Number(
      (db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count,
    );
    const componentsBefore = db.prepare('SELECT * FROM raw_components').all();
    const tokensBefore = db.prepare('SELECT * FROM raw_tokens').all();
    const groupsBefore = db.prepare('SELECT * FROM raw_token_groups').all();
    const latestExpected = new Map(
      PUBLIC_COMMANDS.map((command) => [command, findLatestSessionForCommand(db, command)]),
    );
    db.close();

    const migrated = openPipelineDb(dbPath);
    try {
      const rowsAfter = readSteps(migrated);
      const expectedRows = rowsBefore.filter(
        (row) =>
          !(
            OBSOLETE_COMMANDS.includes(row.command as (typeof OBSOLETE_COMMANDS)[number]) &&
            CLEANUP_STATUSES.includes(row.status as (typeof CLEANUP_STATUSES)[number])
          ),
      );
      expect(rowsAfter).toEqual(expectedRows);
      expect(
        rowsAfter.filter(
          (row) =>
            OBSOLETE_COMMANDS.includes(row.command as (typeof OBSOLETE_COMMANDS)[number]) &&
            CLEANUP_STATUSES.includes(row.status as (typeof CLEANUP_STATUSES)[number]),
        ),
      ).toEqual([]);
      expect(rowsAfter.filter((row) => row.command === 'generate refine')).toHaveLength(1);
      expect(rowsAfter.filter((row) => row.command === 'unrecognized command')).toHaveLength(1);
      expect(
        Number((migrated.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count),
      ).toBe(sessionCountBefore);
      expect(migrated.prepare('SELECT * FROM raw_components').all()).toEqual(componentsBefore);
      expect(migrated.prepare('SELECT * FROM raw_tokens').all()).toEqual(tokensBefore);
      expect(migrated.prepare('SELECT * FROM raw_token_groups').all()).toEqual(groupsBefore);
      for (const command of PUBLIC_COMMANDS) {
        expect(findLatestSessionForCommand(migrated, command)).toBe(latestExpected.get(command));
      }
      expect(findLatestSessionForCommand(migrated, 'print tokens')).toBe(latestExpected.get('print tokens'));
      expect(readFileSync(runsPath, 'utf8')).toBe(runsText);
      expect(readFileSync(reviewPath, 'utf8')).toBe(reviewText);
      expect(migrated.prepare('SELECT name FROM migrations WHERE name = ?').get(CLEANUP_MIGRATION)).toEqual({
        name: CLEANUP_MIGRATION,
      });
    } finally {
      migrated.close();
    }
  });

  it('runs once independently of the prior migration marker and preserves later legacy rows', () => {
    const db = openPipelineDb(dbPath);
    db.prepare('DELETE FROM migrations WHERE name = ?').run(CLEANUP_MIGRATION);
    addStep(db, 'analyze select', 'pending');
    db.close();

    const firstOpen = openPipelineDb(dbPath);
    expect(readSteps(firstOpen).filter((row) => row.command === 'analyze select')).toEqual([]);
    expect(firstOpen.prepare('SELECT name FROM migrations WHERE name = ?').get(PRIOR_MIGRATION)).toEqual({
      name: PRIOR_MIGRATION,
    });
    expect(firstOpen.prepare('SELECT name FROM migrations WHERE name = ?').get(CLEANUP_MIGRATION)).toEqual({
      name: CLEANUP_MIGRATION,
    });
    addStep(firstOpen, 'analyze select', 'pending');
    firstOpen.close();

    const secondOpen = openPipelineDb(dbPath);
    try {
      expect(readSteps(secondOpen).filter((row) => row.command === 'analyze select')).toHaveLength(1);
    } finally {
      secondOpen.close();
    }
  });

  it('opens an already-migrated database while another connection holds the write transaction', () => {
    const writer = openPipelineDb(dbPath);
    writer.exec('BEGIN IMMEDIATE');
    try {
      expect(() => {
        const reader = openPipelineDb(dbPath);
        reader.close();
      }).not.toThrow();
    } finally {
      writer.exec('ROLLBACK');
      writer.close();
    }
  }, 10_000);

  it.each(['delete', 'marker'] as const)('rolls back the migration when the %s operation fails', (operation) => {
    const db = openPipelineDb(dbPath);
    const sessionId = addStep(db, 'print tokens', 'pending');
    db.prepare('DELETE FROM migrations WHERE name = ?').run(CLEANUP_MIGRATION);
    if (operation === 'marker') {
      db.exec(`CREATE TRIGGER reject_cleanup_marker BEFORE INSERT ON migrations
        WHEN NEW.name = '${CLEANUP_MIGRATION}'
        BEGIN SELECT RAISE(ABORT, 'marker insert rejected'); END`);
    } else {
      db.exec(`CREATE TRIGGER reject_cleanup_delete BEFORE DELETE ON steps
        BEGIN SELECT RAISE(ABORT, 'history delete rejected'); END`);
    }
    db.close();

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const failedMigration = openPipelineDb(dbPath);
      failedMigration.close();
      expect(stderrWrite.mock.calls.map(([message]) => String(message)).join('')).toContain(
        operation === 'marker' ? 'marker insert rejected' : 'history delete rejected',
      );
    } finally {
      stderrWrite.mockRestore();
    }

    const verify = new DatabaseSync(dbPath);
    try {
      expect(verify.prepare('SELECT status FROM steps WHERE session_id = ?').get(sessionId)).toEqual({
        status: 'pending',
      });
      expect(verify.prepare('SELECT name FROM migrations WHERE name = ?').get(CLEANUP_MIGRATION)).toBeUndefined();
    } finally {
      verify.close();
    }
  });

  function addStep(db: DatabaseSync, command: string, status: string, startedAt?: string): string {
    rowSequence += 1;
    const sessionId = `history-session-${rowSequence}`;
    const timestamp = startedAt ?? `2026-01-01T00:${String(rowSequence % 60).padStart(2, '0')}:00.000Z`;
    db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(
      sessionId,
      timestamp,
      timestamp,
    );
    db.prepare(
      `INSERT INTO steps (session_id, command, status, started_at, completed_at, inputs, outputs, error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      command,
      status,
      timestamp,
      status === 'complete' ? timestamp : null,
      JSON.stringify({ input: sessionId }),
      JSON.stringify({ output: sessionId }),
      status === 'failed' ? `failure-${sessionId}` : null,
      timestamp,
    );
    return sessionId;
  }

  function readSteps(db: DatabaseSync): Array<Record<string, unknown> & { command: string; status: string }> {
    return db
      .prepare(
        'SELECT id, session_id, command, status, started_at, completed_at, inputs, outputs, error, updated_at FROM steps ORDER BY id',
      )
      .all() as Array<Record<string, unknown> & { command: string; status: string }>;
  }
});
