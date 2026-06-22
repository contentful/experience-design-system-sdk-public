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

function makeComponent(name: string): RawComponentDefinition {
  return { name, source: `// ${name}`, framework: 'react', props: [], slots: [] };
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
    });
  });

  it('returns an empty list for unknown sessions', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      expect(loadScopeComponents(db, 'nonexistent-session')).toEqual([]);
      db.close();
    });
  });
});
