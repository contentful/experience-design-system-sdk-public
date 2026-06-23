import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScopeGate } from '../../../src/import/tui/runScopeGate.js';
import { getOrCreateSession, openPipelineDb, storeRawComponents } from '../../../src/session/db.js';
import type { RawComponentDefinition } from '../../../src/types.js';
import type { ReviewSessionSnapshot } from '../../../src/analyze/select/types.js';

const tempDirs: string[] = [];
const origDbPath = process.env['EDS_PIPELINE_DB_PATH'];
const origArtifactsDir = process.env['EDS_REVIEW_ARTIFACTS_DIR'];

async function withTempDb(run: (ctx: { dbPath: string; artifactsDir: string }) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'run-scope-gate-test-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  const artifactsDir = join(dir, 'reviews');
  process.env['EDS_PIPELINE_DB_PATH'] = dbPath;
  process.env['EDS_REVIEW_ARTIFACTS_DIR'] = artifactsDir;
  try {
    await run({ dbPath, artifactsDir });
  } finally {
    if (origDbPath === undefined) delete process.env['EDS_PIPELINE_DB_PATH'];
    else process.env['EDS_PIPELINE_DB_PATH'] = origDbPath;
    if (origArtifactsDir === undefined) delete process.env['EDS_REVIEW_ARTIFACTS_DIR'];
    else process.env['EDS_REVIEW_ARTIFACTS_DIR'] = origArtifactsDir;
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
  it('writes decisions to DB and snapshot file and calls onAdvanceToGenerate when accepted is non-empty', async () => {
    await withTempDb(async ({ dbPath, artifactsDir }) => {
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
          { name: 'Junk', status: 'rejected' },
        ]);
      } finally {
        db.close();
      }

      const snapshotRaw = await readFile(join(artifactsDir, sessionId, 'current-review-state.json'), 'utf8');
      const snapshot = JSON.parse(snapshotRaw) as ReviewSessionSnapshot;
      expect(Array.isArray(snapshot.components)).toBe(true);
      const byName = Object.fromEntries(snapshot.components.map((c) => [c.name, c]));
      expect(byName['Button']?.status).toBe('accepted');
      expect(byName['Junk']?.status).toBe('rejected');
    });
  });

  it('writes snapshot with all rejected and calls onAdvanceToPushFlow(0) when accepted is empty', async () => {
    await withTempDb(async ({ dbPath, artifactsDir }) => {
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
          { name: 'Button', status: 'rejected' },
          { name: 'Junk', status: 'rejected' },
        ]);
      } finally {
        db.close();
      }

      const snapshotRaw = await readFile(join(artifactsDir, sessionId, 'current-review-state.json'), 'utf8');
      const snapshot = JSON.parse(snapshotRaw) as ReviewSessionSnapshot;
      const byName = Object.fromEntries(snapshot.components.map((c) => [c.name, c]));
      expect(byName['Button']?.status).toBe('rejected');
      expect(byName['Junk']?.status).toBe('rejected');
    });
  });
});
