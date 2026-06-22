import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScopeGate } from '../../../src/import/tui/runScopeGate.js';
import { getOrCreateSession, openPipelineDb, storeRawComponents } from '../../../src/session/db.js';
import type { RawComponentDefinition } from '../../../src/types.js';

const tempDirs: string[] = [];
const origDbPath = process.env['EDS_PIPELINE_DB_PATH'];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'run-scope-gate-test-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  process.env['EDS_PIPELINE_DB_PATH'] = dbPath;
  try {
    await run(dbPath);
  } finally {
    if (origDbPath === undefined) delete process.env['EDS_PIPELINE_DB_PATH'];
    else process.env['EDS_PIPELINE_DB_PATH'] = origDbPath;
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeComponent(name: string): RawComponentDefinition {
  return { name, source: `// ${name}`, framework: 'react', props: [], slots: [] };
}

function seed(dbPath: string): string {
  const db = openPipelineDb(dbPath);
  try {
    const { sessionId } = getOrCreateSession(db, 'new', undefined, {
      command: 'analyze extract',
      inputPath: '/p',
    });
    storeRawComponents(db, sessionId, [makeComponent('Button'), makeComponent('Junk')], { status: 'extracted' });
    return sessionId;
  } finally {
    db.close();
  }
}

describe('runScopeGate', () => {
  it('writes decisions to DB and calls onAdvanceToGenerate when accepted is non-empty', async () => {
    await withTempDb(async (dbPath) => {
      const sessionId = seed(dbPath);
      const onAdvanceToGenerate = vi.fn().mockResolvedValue(undefined);
      const onAdvanceToPushFlow = vi.fn();

      await runScopeGate({
        sessionId,
        decisions: { accepted: ['Button'], rejected: ['Junk'] },
        onAdvanceToGenerate,
        onAdvanceToPushFlow,
      });

      expect(onAdvanceToGenerate).toHaveBeenCalledWith({ sessionId, acceptedCount: 1 });
      expect(onAdvanceToPushFlow).not.toHaveBeenCalled();

      const db = openPipelineDb(dbPath);
      try {
        const rows = db
          .prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name')
          .all(sessionId) as Array<{ name: string; status: string }>;
        expect(rows).toEqual([
          { name: 'Button', status: 'generated' },
          { name: 'Junk', status: 'extracted' },
        ]);
      } finally {
        db.close();
      }
    });
  });

  it('calls onAdvanceToPushFlow(0) when accepted is empty', async () => {
    await withTempDb(async (dbPath) => {
      const sessionId = seed(dbPath);
      const onAdvanceToGenerate = vi.fn();
      const onAdvanceToPushFlow = vi.fn();

      await runScopeGate({
        sessionId,
        decisions: { accepted: [], rejected: ['Button', 'Junk'] },
        onAdvanceToGenerate,
        onAdvanceToPushFlow,
      });

      expect(onAdvanceToGenerate).not.toHaveBeenCalled();
      expect(onAdvanceToPushFlow).toHaveBeenCalledWith(0);

      const db = openPipelineDb(dbPath);
      try {
        const rows = db
          .prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name')
          .all(sessionId) as Array<{ name: string; status: string }>;
        expect(rows).toEqual([
          { name: 'Button', status: 'extracted' },
          { name: 'Junk', status: 'extracted' },
        ]);
      } finally {
        db.close();
      }
    });
  });
});
