import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateSession, loadScopeComponents, openPipelineDb, storeRawComponents } from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'load-scope-components-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeComponent(
  name: string,
  slots: Array<{ name: string; allowedComponents?: string[] }> = [],
): RawComponentDefinition {
  return {
    name,
    source: `// ${name}`,
    framework: 'react',
    props: [],
    slots: slots.map((s) => ({
      name: s.name,
      isDefault: false,
      ...(s.allowedComponents ? { allowedComponents: s.allowedComponents } : {}),
    })),
  };
}

describe('loadScopeComponents', () => {
  it('returns name + componentId for every extracted component, sorted by name', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(db, sessionId, [makeComponent('Card'), makeComponent('Button')], { status: 'extracted' });

      const result = loadScopeComponents(db, sessionId);
      db.close();

      expect(result.map((r) => r.name)).toEqual(['Button', 'Card']);
      expect(result.every((r) => typeof r.componentId === 'string' && r.componentId.length > 0)).toBe(true);
      expect(new Set(result.map((r) => r.componentId)).size).toBe(result.length);
    });
  });

  it('returns an empty list for unknown sessions', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      expect(loadScopeComponents(db, 'nonexistent-session')).toEqual([]);
      db.close();
    });
  });

  it('populates `slots` with joined raw_slots + raw_slot_allowed_components rows', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(
        db,
        sessionId,
        [
          makeComponent('Card', [{ name: 'body', allowedComponents: ['Heading'] }]),
          makeComponent('Heading'),
          makeComponent('Layout', [
            { name: 'header', allowedComponents: ['Heading'] },
            { name: 'sidebar', allowedComponents: ['Card'] },
            { name: 'footer', allowedComponents: [] },
          ]),
          makeComponent('Standalone'),
        ],
        { status: 'extracted' },
      );

      const result = loadScopeComponents(db, sessionId);
      db.close();

      const byName = Object.fromEntries(result.map((r) => [r.name, r]));

      expect(byName.Card?.slots).toEqual([{ name: 'body', allowedComponents: ['Heading'] }]);

      expect(byName.Heading?.slots).toEqual([]);
      expect(byName.Standalone?.slots).toEqual([]);

      expect(byName.Layout?.slots).toEqual([
        { name: 'header', allowedComponents: ['Heading'] },
        { name: 'sidebar', allowedComponents: ['Card'] },
        { name: 'footer', allowedComponents: [] },
      ]);
    });
  });

  it('excludes components whose status is not extracted', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(
        db,
        sessionId,
        [makeComponent('Button'), makeComponent('Card'), makeComponent('AlreadyAccepted')],
        { status: 'extracted' },
      );
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND name = ?`).run(
        sessionId,
        'AlreadyAccepted',
      );

      const result = loadScopeComponents(db, sessionId);
      db.close();

      expect(result.map((r) => r.name)).toEqual(['Button', 'Card']);
    });
  });
});
