import { describe, expect, it } from 'vitest';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  updateStep,
  findLatestSessionForCommand,
} from '../session/db.js';

describe('step state machine', () => {
  it('creates a step, marks it complete, and makes it the latest for the command', () => {
    const db = openPipelineDb(':memory:');
    try {
      const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
      const stepId = createStep(db, sessionId, 'analyze extract', { projectRoot: '/tmp/x' });
      expect(stepId).toBeTypeOf('number');

      updateStep(db, stepId, 'complete', { componentCount: '3' });

      const row = db.prepare('SELECT status, outputs FROM steps WHERE id = ?').get(stepId) as {
        status: string;
        outputs: string;
      };
      expect(row.status).toBe('complete');
      expect(JSON.parse(row.outputs)).toEqual({ componentCount: '3' });

      expect(findLatestSessionForCommand(db, 'analyze extract')).toBe(sessionId);
    } finally {
      db.close();
    }
  });

  it('marks earlier pending steps as interrupted when a new one for the same command is created', () => {
    const db = openPipelineDb(':memory:');
    try {
      const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
      const firstStep = createStep(db, sessionId, 'analyze extract', {});
      createStep(db, sessionId, 'analyze extract', {});

      const first = db.prepare('SELECT status FROM steps WHERE id = ?').get(firstStep) as { status: string };
      expect(first.status).toBe('interrupted');
    } finally {
      db.close();
    }
  });
});
