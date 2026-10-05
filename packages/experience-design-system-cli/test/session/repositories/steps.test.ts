import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb } from '../../../src/session/db.js';
import { createSession } from '../../../src/session/repositories/sessions/write.js';
import { getSessionIdForStep } from '../../../src/session/repositories/steps/read.js';
import {
  createPendingStep,
  updatePendingStepsToInterrupted,
  updateStepStatus,
} from '../../../src/session/repositories/steps/write.js';

const tempDirs: string[] = [];

async function withDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'steps-repo-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('steps repository', () => {
  it('createPendingStep creates a pending step and returns its rowid', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      const id = createPendingStep(db, 'sess-1', 'analyze extract', { k: 'v' }, now);
      expect(id).toBeGreaterThan(0);
      const row = db.prepare('SELECT status, inputs FROM steps WHERE id = ?').get(id) as {
        status: string;
        inputs: string;
      };
      expect(row.status).toBe('pending');
      expect(JSON.parse(row.inputs)).toEqual({ k: 'v' });
      db.close();
    });
  });

  it('updatePendingStepsToInterrupted flips pending steps for the command only', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      const s1 = createPendingStep(db, 'sess-1', 'analyze extract', {}, now);
      const s2 = createPendingStep(db, 'sess-1', 'analyze select', {}, now);
      updatePendingStepsToInterrupted(db, 'sess-1', 'analyze extract', now);
      const r1 = db.prepare('SELECT status FROM steps WHERE id = ?').get(s1) as { status: string };
      const r2 = db.prepare('SELECT status FROM steps WHERE id = ?').get(s2) as { status: string };
      expect(r1.status).toBe('interrupted');
      expect(r2.status).toBe('pending');
      db.close();
    });
  });

  it('updateStepStatus sets status/outputs/error/completed_at', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      const id = createPendingStep(db, 'sess-1', 'analyze extract', {}, now);
      updateStepStatus(db, id, 'complete', { out: '1' }, null, now);
      const row = db.prepare('SELECT status, outputs, error, completed_at FROM steps WHERE id = ?').get(id) as {
        status: string;
        outputs: string;
        error: string | null;
        completed_at: string;
      };
      expect(row.status).toBe('complete');
      expect(JSON.parse(row.outputs)).toEqual({ out: '1' });
      expect(row.error).toBeNull();
      expect(row.completed_at).toBe(now);
      db.close();
    });
  });

  it('getSessionIdForStep returns the parent session id, or null when missing', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      const id = createPendingStep(db, 'sess-1', 'analyze extract', {}, now);
      expect(getSessionIdForStep(db, id)).toBe('sess-1');
      expect(getSessionIdForStep(db, 99999)).toBeNull();
      db.close();
    });
  });
});
