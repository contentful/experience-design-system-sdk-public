import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb } from '../../../src/session/db.js';
import { withTransaction } from '../../../src/session/repositories/shared/with-transaction.js';

const tempDirs: string[] = [];

async function withDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'transaction-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('withTransaction', () => {
  it('commits on success and returns the callback result', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      const result = withTransaction(db, () => {
        db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
          'sess-1',
          null,
          now,
          now,
        );
        return 42;
      });
      expect(result).toBe(42);
      const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get('sess-1') as { id: string } | undefined;
      expect(row?.id).toBe('sess-1');
      db.close();
    });
  });

  it('rolls back and rethrows when the callback throws', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      expect(() =>
        withTransaction(db, () => {
          db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
            'sess-1',
            null,
            now,
            now,
          );
          throw new Error('boom');
        }),
      ).toThrow(/boom/);
      const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get('sess-1');
      expect(row).toBeUndefined();
      db.close();
    });
  });
});
