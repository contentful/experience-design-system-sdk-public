import { seedCompleteEmptyComponents } from '../source-session-fixture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  getOrCreateSession,
  openPipelineDb,
  storeDTCGTokens,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  createReviewHistorySnapshot,
  finalizeReviewSession,
  loadReviewSessionState,
} from '../../../src/tui/import/steps/09-review/session.js';
import type { CdfReviewEntry, ReviewComponentStatus } from '../../../src/tui/import/steps/09-review/types.js';

const entry: CDFComponentEntry = { $type: 'component', $properties: {} };
const review = (key: string, status: CdfReviewEntry['status']): CdfReviewEntry => ({ key, entry, status });
const keepOrder = (entries: CdfReviewEntry[]) => entries;

describe('the review session and the pipeline database', () => {
  let dir: string;
  let previousDbPath: string | undefined;

  const newSession = (): string => {
    const db = openPipelineDb();
    try {
      return getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    } finally {
      db.close();
    }
  };
  const seed = async (sessionId: string, names: string[]): Promise<void> => {
    const db = openPipelineDb();
    try {
      await seedCompleteEmptyComponents(db, sessionId, dir, names);
    } finally {
      db.close();
    }
  };
  const statuses = (sessionId: string): Record<string, string> => {
    const db = openPipelineDb();
    try {
      const rows = db.prepare('SELECT name, status FROM raw_components WHERE session_id = ?').all(sessionId) as Array<{
        name: string;
        status: string;
      }>;
      return Object.fromEntries(rows.map((row) => [row.name, row.status]));
    } finally {
      db.close();
    }
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'review-session-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  describe('loadReviewSessionState', () => {
    it('loads the generated definitions, every one waiting for review', async () => {
      const sessionId = newSession();
      await seed(sessionId, ['Button', 'Card']);

      const result = loadReviewSessionState({ extractSessionId: sessionId, sortEntries: keepOrder });

      expect(result.error).toBeNull();
      expect(result.entries.map((e) => [e.key, e.status])).toEqual([
        ['Button', 'needs-review'],
        ['Card', 'needs-review'],
      ]);
    });

    it('reports an error and nothing else when there are no generated definitions', async () => {
      const sessionId = newSession();

      const result = loadReviewSessionState({ extractSessionId: sessionId, sortEntries: keepOrder });

      expect(result).toMatchObject({
        entries: [],
        tokens: [],
        error: 'No generated definitions found for this session. Try re-running generate.',
      });
    });

    it('reads the tokens from the extraction session when no token session is given', async () => {
      const sessionId = newSession();
      await seed(sessionId, ['Button']);
      const db = openPipelineDb();
      storeDTCGTokens(db, sessionId, [], [{ path: 'color.brand', $type: 'color', $value: '#06f' }]);
      db.close();

      const result = loadReviewSessionState({ extractSessionId: sessionId, sortEntries: keepOrder });

      expect(result.tokens).toEqual([{ path: 'color.brand', kind: 'color' }]);
    });

    it('reads the tokens from the token session when one is given, as when tokens were reused', async () => {
      const extractId = newSession();
      const tokenId = newSession();
      await seed(extractId, ['Button']);
      const db = openPipelineDb();
      storeDTCGTokens(db, extractId, [], [{ path: 'color.own', $type: 'color', $value: '#000' }]);
      storeDTCGTokens(db, tokenId, [], [{ path: 'color.reused', $type: 'color', $value: '#fff' }]);
      db.close();

      const result = loadReviewSessionState({
        extractSessionId: extractId,
        tokenSessionId: tokenId,
        sortEntries: keepOrder,
      });

      expect(result.tokens).toEqual([{ path: 'color.reused', kind: 'color' }]);
    });

    it('falls back to the extraction session when the token session is null', async () => {
      const sessionId = newSession();
      await seed(sessionId, ['Button']);
      const db = openPipelineDb();
      storeDTCGTokens(db, sessionId, [], [{ path: 'color.brand', $type: 'color', $value: '#06f' }]);
      db.close();

      const result = loadReviewSessionState({
        extractSessionId: sessionId,
        tokenSessionId: null,
        sortEntries: keepOrder,
      });

      expect(result.tokens).toEqual([{ path: 'color.brand', kind: 'color' }]);
    });

    it('hands what loadExtra read to the sort and back to the caller', async () => {
      const sessionId = newSession();
      await seed(sessionId, ['Button', 'Card']);

      const result = loadReviewSessionState({
        extractSessionId: sessionId,
        loadExtra: () => ['Card', 'Button'],
        sortEntries: (entries, order) => [...entries].sort((a, b) => order!.indexOf(a.key) - order!.indexOf(b.key)),
      });

      expect(result.entries.map((e) => e.key)).toEqual(['Card', 'Button']);
      expect(result.extra).toEqual(['Card', 'Button']);
    });

    it('still returns what loadExtra read when there are no definitions', async () => {
      const sessionId = newSession();

      const result = loadReviewSessionState({
        extractSessionId: sessionId,
        loadExtra: () => 'extra',
        sortEntries: keepOrder,
      });

      expect(result.extra).toBe('extra');
    });
  });

  describe('finalizeReviewSession', () => {
    it('marks rejected and still-unresolved components rejected in the database, and leaves accepted ones alone', async () => {
      const sessionId = newSession();
      await seed(sessionId, ['Accepted', 'Rejected', 'Unresolved', 'Reviewed']);
      const db = openPipelineDb();
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);
      db.close();

      const counts = finalizeReviewSession(sessionId, [
        review('Accepted', 'accepted'),
        review('Rejected', 'rejected'),
        review('Unresolved', 'needs-review'),
        review('Reviewed', 'reviewed'),
      ]);

      expect(statuses(sessionId)).toEqual({
        Accepted: 'generated',
        Rejected: 'generate-rejected',
        Unresolved: 'generate-rejected',
        Reviewed: 'generate-rejected',
      });
      expect(counts).toEqual({ accepted: 1, rejected: 1, unresolved: 1 });
    });

    it('only touches the session it was given', async () => {
      const mine = newSession();
      const other = newSession();
      await seed(mine, ['Button']);
      await seed(other, ['Button']);
      const db = openPipelineDb();
      db.prepare(`UPDATE raw_components SET status = 'generated'`).run();
      db.close();

      finalizeReviewSession(mine, [review('Button', 'rejected')]);

      expect(statuses(mine)).toEqual({ Button: 'generate-rejected' });
      expect(statuses(other)).toEqual({ Button: 'generated' });
    });

    it('rejects fabricated accepted identities before finalization', async () => {
      expect(() =>
        finalizeReviewSession('no-such-session', [review('A', 'accepted'), review('B', 'accepted')]),
      ).toThrow('Unknown');
    });
  });

  describe('createReviewHistorySnapshot', () => {
    it('copies the components, with no auto-rejected and no undo snapshot by default', async () => {
      expect(createReviewHistorySnapshot([review('A', 'accepted')])).toEqual({
        components: [{ key: 'A', componentId: undefined, entry, status: 'accepted' }],
        autoRejected: [],
        undoSnapshot: null,
      });
    });

    it('copies the undo snapshot instead of sharing it', async () => {
      const undo = new Map<string, ReviewComponentStatus>([['A', 'accepted']]);
      const snapshot = createReviewHistorySnapshot([review('A', 'rejected')], {
        autoRejected: ['B'],
        undoSnapshot: undo,
      });
      undo.set('C', 'rejected');

      expect(snapshot.autoRejected).toEqual(['B']);
      expect([...snapshot.undoSnapshot!]).toEqual([['A', 'accepted']]);
    });

    it('treats a null undo snapshot as none', async () => {
      expect(createReviewHistorySnapshot([], { undoSnapshot: null }).undoSnapshot).toBeNull();
    });
  });
});
