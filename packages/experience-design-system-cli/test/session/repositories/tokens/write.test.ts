import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession } from '../../../../src/session/db.js';
import { upsertRawToken, upsertRawTokenGroup } from '../../../../src/session/repositories/tokens/write.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'tokens-write-'));
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
  const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
  return sessionId;
}

describe('upsertRawToken', () => {
  it('inserts a new token row', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      upsertRawToken(db, sessionId, {
        tool: 'set_token',
        path: 'color.primary',
        type: 'color',
        value: '#0000FF',
        description: 'Primary brand color',
      });

      const row = db
        .prepare('SELECT path, type, value, description FROM raw_tokens WHERE session_id = ? AND path = ?')
        .get(sessionId, 'color.primary');
      expect(row).toEqual({
        path: 'color.primary',
        type: 'color',
        value: JSON.stringify('#0000FF'),
        description: 'Primary brand color',
      });
      db.close();
    });
  });

  it('overwrites an existing token at the same path', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      upsertRawToken(db, sessionId, { tool: 'set_token', path: 'color.primary', type: 'color', value: '#000000' });
      upsertRawToken(db, sessionId, {
        tool: 'set_token',
        path: 'color.primary',
        type: 'color',
        value: '#FFFFFF',
        description: 'now white',
      });

      const rows = db
        .prepare('SELECT value, description FROM raw_tokens WHERE session_id = ? AND path = ?')
        .all(sessionId, 'color.primary');
      expect(rows).toEqual([{ value: JSON.stringify('#FFFFFF'), description: 'now white' }]);
      db.close();
    });
  });

  it('serializes non-primitive values as JSON', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      upsertRawToken(db, sessionId, {
        tool: 'set_token',
        path: 'shadow.default',
        type: 'shadow',
        value: { offsetX: 0, offsetY: 2, blur: 4, color: '#000' },
      });

      const row = db
        .prepare('SELECT value FROM raw_tokens WHERE session_id = ? AND path = ?')
        .get(sessionId, 'shadow.default') as { value: string };
      expect(JSON.parse(row.value)).toEqual({ offsetX: 0, offsetY: 2, blur: 4, color: '#000' });
      db.close();
    });
  });
});

describe('upsertRawTokenGroup', () => {
  it('inserts a new group row', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      upsertRawTokenGroup(db, sessionId, {
        tool: 'set_group',
        path: 'color',
        description: 'Color palette tokens',
      });

      const row = db
        .prepare('SELECT path, description FROM raw_token_groups WHERE session_id = ? AND path = ?')
        .get(sessionId, 'color');
      expect(row).toEqual({ path: 'color', description: 'Color palette tokens' });
      db.close();
    });
  });

  it('overwrites the description on conflict at the same path', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      upsertRawTokenGroup(db, sessionId, { tool: 'set_group', path: 'color', description: 'old' });
      upsertRawTokenGroup(db, sessionId, { tool: 'set_group', path: 'color', description: 'new' });

      const rows = db
        .prepare('SELECT description FROM raw_token_groups WHERE session_id = ? AND path = ?')
        .all(sessionId, 'color');
      expect(rows).toEqual([{ description: 'new' }]);
      db.close();
    });
  });

  it('accepts a null description', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      upsertRawTokenGroup(db, sessionId, { tool: 'set_group', path: 'spacing' });

      const row = db
        .prepare('SELECT description FROM raw_token_groups WHERE session_id = ? AND path = ?')
        .get(sessionId, 'spacing');
      expect(row).toEqual({ description: null });
      db.close();
    });
  });
});
