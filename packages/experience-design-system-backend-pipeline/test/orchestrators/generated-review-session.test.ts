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
  loadCDFComponents,
} from '../../src/index.js';
import * as reviewApi from '../../src/orchestrators/review-generated-session/review-generated-session.js';
import {
  finalizeReviewSession,
  loadReviewSessionState,
} from '../../src/orchestrators/review-generated-session/review-generated-session.js';
import type { GeneratedReviewEntry as CdfReviewEntry } from '../../src/orchestrators/review-generated-session/types.js';

const raw = (name: string) => ({ name, source: `src/${name}.tsx`, framework: 'react' as const, props: [], slots: [] });
const entry: CDFComponentEntry = { $type: 'component', $properties: {} };
const review = (key: string, status: CdfReviewEntry['status']): CdfReviewEntry => ({ key, entry, status });

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
    it('keeps failed generation visible even when no definition was committed', () => {
      const sessionId = newSession();
      const result = loadReviewSessionState({
        extractSessionId: sessionId,
        generationIssues: [{ componentName: 'Button', error: 'Unknown slot' }],
      });
      expect(result.error).toBeNull();
      expect(result.entries).toEqual([
        { key: 'Button', entry, status: 'needs-review', generationError: 'Unknown slot' },
      ]);
    });

    it('flags an existing definition once and leaves unaffected components alone', () => {
      const sessionId = newSession();
      seed(sessionId, ['Button', 'Card']);
      const result = loadReviewSessionState({
        extractSessionId: sessionId,
        generationIssues: [{ componentName: 'Button', error: 'Unknown slot' }],
      });
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]?.generationError).toBe('Unknown slot');
      expect(result.entries[1]?.generationError).toBeUndefined();
    });

    it('loads the generated definitions, every one waiting for review', () => {
      const sessionId = newSession();
      seed(sessionId, ['Button', 'Card']);

      const result = loadReviewSessionState({ extractSessionId: sessionId });

      expect(result.error).toBeNull();
      expect(result.entries.map((e) => [e.key, e.status])).toEqual([
        ['Button', 'needs-review'],
        ['Card', 'needs-review'],
      ]);
    });

    it('reports an error and nothing else when there are no generated definitions', () => {
      const sessionId = newSession();

      const result = loadReviewSessionState({ extractSessionId: sessionId });

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

      const result = loadReviewSessionState({ extractSessionId: sessionId });

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
      });

      expect(result.tokens).toEqual([{ path: 'color.brand', kind: 'color' }]);
    });

    it('returns persisted slot cycles even when no definitions were generated', () => {
      const sessionId = newSession();
      const result = loadReviewSessionState({ extractSessionId: sessionId });
      expect(result.slotCycles).toEqual([]);
      expect(result.error).not.toBeNull();
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

  describe('review edits and metadata', () => {
    it('parses and persists a draft through the backend, preserving other components', () => {
      const sessionId = newSession();
      seed(sessionId, ['Button', 'Card']);
      const edited = { ...entry, $description: 'Updated' };
      expect(reviewApi.saveGeneratedReviewDraft(sessionId, 'Button', JSON.stringify({ Button: edited }))).toEqual(
        edited,
      );
      const db = openPipelineDb();
      try {
        expect(loadCDFComponents(db, sessionId).find((item) => item.key === 'Button')?.entry.$description).toBe(
          'Updated',
        );
        expect(
          loadCDFComponents(db, sessionId).find((item) => item.key === 'Card')?.entry.$description,
        ).toBeUndefined();
      } finally {
        db.close();
      }
    });

    it('rejects an invalid draft without changing the stored definition', () => {
      const sessionId = newSession();
      seed(sessionId, ['Button']);
      expect(() => reviewApi.saveGeneratedReviewDraft(sessionId, 'Button', '{"$type":"token"}')).toThrow(
        'Invalid CDF entry',
      );
      const result = loadReviewSessionState({ extractSessionId: sessionId });
      expect(result.entries[0]?.entry).toEqual(entry);
    });

    it('returns missing metadata as null without exposing a database handle', () => {
      expect(reviewApi.loadGeneratedReviewMetadata(newSession(), 'Missing')).toEqual({
        metadata: null,
        rationale: null,
      });
    });

    it('refreshes and persists cycles while excluding rejected components', () => {
      const sessionId = newSession();
      const a = {
        ...review('A', 'accepted'),
        entry: { ...entry, $slots: { children: { $allowedComponents: ['B'] } } },
      };
      const b = {
        ...review('B', 'accepted'),
        entry: { ...entry, $slots: { children: { $allowedComponents: ['A'] } } },
      };
      const cycles = reviewApi.refreshGeneratedReviewCycles(sessionId, [a, b]);
      expect(cycles).toHaveLength(1);
      expect(cycles[0]?.suggestedBreak).not.toBeNull();
      expect(loadReviewSessionState({ extractSessionId: sessionId }).slotCycles).toEqual(cycles);
      expect(reviewApi.refreshGeneratedReviewCycles(sessionId, [a, { ...b, status: 'rejected' }])).toEqual([]);
      expect(loadReviewSessionState({ extractSessionId: sessionId }).slotCycles).toEqual([]);
    });
  });
});
