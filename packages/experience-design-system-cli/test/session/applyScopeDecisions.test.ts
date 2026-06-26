import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyScopeDecisions,
  getOrCreateSession,
  openPipelineDb,
  storeRawComponents,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'apply-scope-decisions-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeComponent(name: string): RawComponentDefinition {
  return { name, source: `// ${name}`, framework: 'react', props: [], slots: [] };
}

function readStatuses(dbPath: string, sessionId: string): Record<string, string> {
  const db = openPipelineDb(dbPath);
  try {
    const rows = db
      .prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name')
      .all(sessionId) as Array<{ name: string; status: string }>;
    return Object.fromEntries(rows.map((r) => [r.name, r.status]));
  } finally {
    db.close();
  }
}

describe('applyScopeDecisions', () => {
  it('marks accepted components as generated and leaves the rest as extracted', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(db, sessionId, [makeComponent('Button'), makeComponent('Card'), makeComponent('Junk')], {
        status: 'extracted',
      });

      applyScopeDecisions(db, sessionId, { accepted: ['Button', 'Card'], rejected: ['Junk'] });

      db.close();
      expect(readStatuses(dbPath, sessionId)).toEqual({
        Button: 'generated',
        Card: 'generated',
        Junk: 'extracted',
      });
    });
  });

  it('is a no-op when accepted is empty', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(db, sessionId, [makeComponent('A'), makeComponent('B')], { status: 'extracted' });

      applyScopeDecisions(db, sessionId, { accepted: [], rejected: ['A', 'B'] });

      db.close();
      expect(readStatuses(dbPath, sessionId)).toEqual({ A: 'extracted', B: 'extracted' });
    });
  });

  it('does not touch components for other sessions', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const s1 = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract', inputPath: '/p1' }).sessionId;
      const s2 = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract', inputPath: '/p2' }).sessionId;
      storeRawComponents(db, s1, [makeComponent('Shared')], { status: 'extracted' });
      storeRawComponents(db, s2, [makeComponent('Shared')], { status: 'extracted' });

      applyScopeDecisions(db, s1, { accepted: ['Shared'], rejected: [] });

      db.close();
      expect(readStatuses(dbPath, s1).Shared).toBe('generated');
      expect(readStatuses(dbPath, s2).Shared).toBe('extracted');
    });
  });

  it('lets accepted win when a name appears in both accepted and rejected', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(db, sessionId, [makeComponent('Foo')], { status: 'extracted' });

      applyScopeDecisions(db, sessionId, { accepted: ['Foo'], rejected: ['Foo'] });

      db.close();
      expect(readStatuses(dbPath, sessionId)).toEqual({ Foo: 'generated' });
    });
  });
});
