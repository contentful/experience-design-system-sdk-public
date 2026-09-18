import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession } from '../../../../src/session/db.js';
import { storeDtcgTokens } from '../../../../src/session/services/tokens/store-dtcg-tokens.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'store-dtcg-tokens-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function seedSession(db: ReturnType<typeof openPipelineDb>) {
  const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'generate tokens' });
  return sessionId;
}

describe('storeDtcgTokens', () => {
  it('replaces prior groups + tokens and bumps session timestamp', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      storeDtcgTokens(
        db,
        sessionId,
        [{ path: 'color', $description: 'Colors', tokenIds: [] }],
        [{ path: 'color.primary', $type: 'color', $value: '#000' }],
      );
      storeDtcgTokens(
        db,
        sessionId,
        [
          { path: 'color', $description: 'Updated', tokenIds: [] },
          { path: 'spacing', tokenIds: [] },
        ],
        [
          { path: 'color.primary', $type: 'color', $value: '#FFF' },
          { path: 'spacing.md', $type: 'dimension', $value: '16px' },
        ],
      );

      const groups = db
        .prepare('SELECT path, description FROM raw_token_groups WHERE session_id = ? ORDER BY path')
        .all(sessionId);
      expect(groups).toEqual([
        { path: 'color', description: 'Updated' },
        { path: 'spacing', description: null },
      ]);

      const tokens = db
        .prepare('SELECT path, type, value FROM raw_tokens WHERE session_id = ? ORDER BY path')
        .all(sessionId);
      expect(tokens).toEqual([
        { path: 'color.primary', type: 'color', value: JSON.stringify('#FFF') },
        { path: 'spacing.md', type: 'dimension', value: JSON.stringify('16px') },
      ]);

      const initial = db.prepare('SELECT created_at FROM sessions WHERE id = ?').get(sessionId) as {
        created_at: string;
      };
      const updated = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(sessionId) as {
        updated_at: string;
      };
      expect(updated.updated_at >= initial.created_at).toBe(true);
      db.close();
    });
  });

  it('is a no-op-per-session — a second session is unaffected', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const a = seedSession(db);
      const { sessionId: b } = getOrCreateSession(db, undefined, 'alt', { command: 'generate tokens' });

      storeDtcgTokens(
        db,
        a,
        [{ path: 'color', tokenIds: [] }],
        [{ path: 'color.primary', $type: 'color', $value: '#000' }],
      );
      storeDtcgTokens(
        db,
        b,
        [{ path: 'spacing', tokenIds: [] }],
        [{ path: 'spacing.md', $type: 'dimension', $value: '16px' }],
      );

      const rowsA = db.prepare('SELECT path FROM raw_tokens WHERE session_id = ?').all(a);
      const rowsB = db.prepare('SELECT path FROM raw_tokens WHERE session_id = ?').all(b);
      expect(rowsA).toEqual([{ path: 'color.primary' }]);
      expect(rowsB).toEqual([{ path: 'spacing.md' }]);
      db.close();
    });
  });

  it('runs inside a transaction — a mid-write failure leaves prior state intact', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      storeDtcgTokens(db, sessionId, [], [{ path: 'color.primary', $type: 'color', $value: '#000' }]);

      expect(() =>
        storeDtcgTokens(
          db,
          sessionId,
          [],
          // The second entry duplicates the first path — SQLite primary-key
          // constraint fires mid-write and the transaction rolls back.
          [
            { path: 'color.secondary', $type: 'color', $value: '#FFF' },
            { path: 'color.secondary', $type: 'color', $value: '#000' },
          ],
        ),
      ).toThrow();

      const rows = db.prepare('SELECT path FROM raw_tokens WHERE session_id = ?').all(sessionId);
      expect(rows).toEqual([{ path: 'color.primary' }]);
      db.close();
    });
  });
});
