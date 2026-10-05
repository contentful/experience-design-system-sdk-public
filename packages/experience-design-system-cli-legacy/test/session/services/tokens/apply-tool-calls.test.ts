import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb } from '../../../../src/session/db.js';
import { createSession } from '../../../../src/session/repositories/sessions/write.js';
import { applyTokenToolCalls } from '../../../../src/session/services/tokens/apply-tool-calls.js';
import { getDtcgTokensForSession } from '../../../../src/session/repositories/tokens/read.js';

const tempDirs: string[] = [];

async function withDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'apply-token-calls-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('applyTokenToolCalls', () => {
  it('applies set_token and set_group calls in a single transaction', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      const result = applyTokenToolCalls(
        db,
        'sess-1',
        [
          { tool: 'set_group', path: 'color.brand', description: 'Brand' },
          { tool: 'set_token', path: 'color.brand.primary', type: 'color', value: '#f00', description: 'primary' },
          { tool: 'set_token', path: 'color.brand.secondary', type: 'color', value: '#0f0' },
        ],
        [],
      );
      expect(result.groups).toBe(1);
      expect(result.tokens).toBe(2);
      const { groups, tokens } = getDtcgTokensForSession(db, 'sess-1');
      expect(groups[0]?.path).toBe('color.brand');
      expect(tokens.map((t) => t.path)).toEqual(['color.brand.primary', 'color.brand.secondary']);
      db.close();
    });
  });

  it('is idempotent — running the same set_token twice keeps one row (upsert)', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      applyTokenToolCalls(db, 'sess-1', [{ tool: 'set_token', path: 'x', type: 'color', value: '#000' }], []);
      applyTokenToolCalls(db, 'sess-1', [{ tool: 'set_token', path: 'x', type: 'color', value: '#fff' }], []);
      const { tokens } = getDtcgTokensForSession(db, 'sess-1');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.$value).toBe('#fff');
      db.close();
    });
  });

  it('rolls back on error — no partial writes', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      // Force a failure by passing a call with a null path on the underlying schema
      expect(() =>
        applyTokenToolCalls(
          db,
          'sess-1',
          [
            { tool: 'set_token', path: 'ok', type: 'color', value: '#0f0' },
            // @ts-expect-error deliberately bad path to trigger NOT NULL failure
            { tool: 'set_token', path: null, type: 'color', value: '#f00' },
          ],
          [],
        ),
      ).toThrow();
      const { tokens } = getDtcgTokensForSession(db, 'sess-1');
      expect(tokens).toEqual([]);
      db.close();
    });
  });

  it('preserves incoming warnings and passes them through', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      const result = applyTokenToolCalls(db, 'sess-1', [], ['a warning']);
      expect(result.warnings).toEqual(['a warning']);
      db.close();
    });
  });
});
