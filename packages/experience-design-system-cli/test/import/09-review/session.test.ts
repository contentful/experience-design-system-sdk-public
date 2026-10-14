import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  getOrCreateSession,
  openPipelineDb,
  storeCDFComponents,
  storeDTCGTokens,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  createReviewHistorySnapshot,
  finalizeReviewSession,
  loadReviewSessionState,
} from '../../../src/tui/import/steps/09-review/session.js';
import type { CdfReviewEntry, ReviewComponentStatus } from '../../../src/tui/import/steps/09-review/types.js';

const raw = (name: string) => ({ name, source: `src/${name}.tsx`, framework: 'react' as const, props: [], slots: [] });
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
  const seed = (sessionId: string, names: string[]): void => {
    const db = openPipelineDb();
    try {
      storeRawComponents(db, sessionId, names.map(raw));
      storeCDFComponents(
        db,
        sessionId,
        names.map((key) => ({ key, entry })),
      );
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
    it('loads the generated definitions, every one waiting for review', () => {
      const sessionId = newSession();
      seed(sessionId, ['Button', 'Card']);

      const result = loadReviewSessionState({ extractSessionId: sessionId, sortEntries: keepOrder });

      expect(result.error).toBeNull();
      expect(result.entries.map((e) => [e.key, e.status])).toEqual([
        ['Button', 'needs-review'],
        ['Card', 'needs-review'],
      ]);
    });

    it('reports an error and nothing else when there are no generated definitions', () => {
      const sessionId = newSession();

      const result = loadReviewSessionState({ extractSessionId: sessionId, sortEntries: keepOrder });

      expect(result).toMatchObject({
        entries: [],
        tokens: [],
        error: 'No generated definitions found for this session. Try re-running generate.',
      });
    });

    it('reads the tokens from the extraction session when no token session is given', () => {
      const sessionId = newSession();
      seed(sessionId, ['Button']);
      const db = openPipelineDb();
      storeDTCGTokens(db, sessionId, [], [{ path: 'color.brand', $type: 'color', $value: '#06f' }]);
      db.close();

      const result = loadReviewSessionState({ extractSessionId: sessionId, sortEntries: keepOrder });

      expect(result.tokens).toEqual([{ path: 'color.brand', kind: 'color' }]);
    });

    it('reads the tokens from the token session when one is given, as when tokens were reused', () => {
      const extractId = newSession();
      const tokenId = newSession();
      seed(extractId, ['Button']);
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

    it('falls back to the extraction session when the token session is null', () => {
      const sessionId = newSession();
      seed(sessionId, ['Button']);
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

    it('hands what loadExtra read to the sort and back to the caller', () => {
      const sessionId = newSession();
      seed(sessionId, ['Button', 'Card']);

      const result = loadReviewSessionState({
        extractSessionId: sessionId,
        loadExtra: () => ['Card', 'Button'],
        sortEntries: (entries, order) => [...entries].sort((a, b) => order!.indexOf(a.key) - order!.indexOf(b.key)),
      });

      expect(result.entries.map((e) => e.key)).toEqual(['Card', 'Button']);
      expect(result.extra).toEqual(['Card', 'Button']);
    });

    it('still returns what loadExtra read when there are no definitions', () => {
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
    it('marks rejected and still-unresolved components rejected in the database, and leaves accepted ones alone', () => {
      const sessionId = newSession();
      seed(sessionId, ['Accepted', 'Rejected', 'Unresolved', 'Reviewed']);
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
        Reviewed: 'generated',
      });
      expect(counts).toEqual({ accepted: 1, rejected: 1, unresolved: 1 });
    });

    it('removes rejected and unresolved components from every slot, and keeps the parents and accepted children', () => {
      const sessionId = newSession();
      const db = openPipelineDb();
      const slotted = (name: string, ...allowed: string[]) => ({
        ...raw(name),
        slots: [{ name: 'children', allowedComponents: allowed }] as never,
      });
      storeRawComponents(db, sessionId, [
        slotted('Flex', 'Text', 'Button', 'Icon'),
        slotted('Card', 'Text'),
        raw('Text'),
        raw('Button'),
        raw('Icon'),
      ]);
      db.close();

      finalizeReviewSession(sessionId, [
        review('Flex', 'accepted'),
        review('Card', 'accepted'),
        review('Text', 'rejected'),
        review('Button', 'accepted'),
        review('Icon', 'needs-review'),
      ]);

      const read = openPipelineDb();
      try {
        const rows = read
          .prepare(
            `SELECT c.name AS name, a.allowed_component AS allowed
             FROM raw_slot_allowed_components a
             JOIN raw_components c ON c.session_id = a.session_id AND c.component_id = a.component_id
             WHERE a.session_id = ? ORDER BY c.name, a.position`,
          )
          .all(sessionId) as Array<{ name: string; allowed: string }>;
        const allowedBy: Record<string, string[]> = {};
        for (const row of rows) (allowedBy[row.name] ??= []).push(row.allowed);
        expect(allowedBy).toEqual({ Flex: ['Button'] });
      } finally {
        read.close();
      }
    });

    it('only touches the session it was given', () => {
      const mine = newSession();
      const other = newSession();
      seed(mine, ['Button']);
      seed(other, ['Button']);
      const db = openPipelineDb();
      db.prepare(`UPDATE raw_components SET status = 'generated'`).run();
      db.close();

      finalizeReviewSession(mine, [review('Button', 'rejected')]);

      expect(statuses(mine)).toEqual({ Button: 'generate-rejected' });
      expect(statuses(other)).toEqual({ Button: 'generated' });
    });

    it('counts without touching the database when everything is accepted', () => {
      const counts = finalizeReviewSession('no-such-session', [review('A', 'accepted'), review('B', 'accepted')]);

      expect(counts).toEqual({ accepted: 2, rejected: 0, unresolved: 0 });
    });
  });

  describe('createReviewHistorySnapshot', () => {
    it('copies the components, with no auto-rejected and no undo snapshot by default', () => {
      expect(createReviewHistorySnapshot([review('A', 'accepted')])).toEqual({
        components: [{ key: 'A', entry, status: 'accepted' }],
        autoRejected: [],
        undoSnapshot: null,
      });
    });

    it('copies the undo snapshot instead of sharing it', () => {
      const undo = new Map<string, ReviewComponentStatus>([['A', 'accepted']]);
      const snapshot = createReviewHistorySnapshot([review('A', 'rejected')], {
        autoRejected: ['B'],
        undoSnapshot: undo,
      });
      undo.set('C', 'rejected');

      expect(snapshot.autoRejected).toEqual(['B']);
      expect([...snapshot.undoSnapshot!]).toEqual([['A', 'accepted']]);
    });

    it('treats a null undo snapshot as none', () => {
      expect(createReviewHistorySnapshot([], { undoSnapshot: null }).undoSnapshot).toBeNull();
    });
  });
});
