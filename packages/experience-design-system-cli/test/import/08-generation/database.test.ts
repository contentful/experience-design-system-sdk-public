import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getOrCreateSession,
  loadDTCGTokens,
  openPipelineDb,
  storeCDFComponents,
  storeDTCGTokens,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import { prepareMapTokens } from '../../../src/tui/import/steps/08-generation/map-tokens.js';
import { saveDecisions } from '../../../src/tui/import/steps/08-generation/save-decisions.js';

const raw = (name: string) => ({
  name,
  source: `src/${name}.tsx`,
  framework: 'react' as const,
  props: [],
  slots: [],
});
const token = (path: string) => ({ path, $type: 'color' as const, $value: '#06f' });
const designProp = { $type: 'token' as const, $category: 'design' as const, '$token.kind': 'color' as const };

describe('the generation stage and the pipeline database', () => {
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
    dir = await mkdtemp(join(tmpdir(), 'generation-db-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  describe('saveDecisions', () => {
    it('marks the accepted components generated and the rejected ones rejected', async () => {
      const sessionId = newSession();
      const db = openPipelineDb();
      storeRawComponents(db, sessionId, [raw('Button'), raw('Card'), raw('Helper')]);
      db.close();

      await saveDecisions({ sessionId, decisions: { accepted: ['Button', 'Card'], rejected: ['Helper'] } });

      expect(statuses(sessionId)).toEqual({ Button: 'generated', Card: 'generated', Helper: 'rejected' });
    });

    it('does not reject something that is also accepted', async () => {
      const sessionId = newSession();
      const db = openPipelineDb();
      storeRawComponents(db, sessionId, [raw('Button')]);
      db.close();

      await saveDecisions({ sessionId, decisions: { accepted: ['Button'], rejected: ['Button'] } });

      expect(statuses(sessionId)).toEqual({ Button: 'generated' });
    });

    it('leaves another session alone', async () => {
      const first = newSession();
      const second = newSession();
      const db = openPipelineDb();
      storeRawComponents(db, first, [raw('Button')]);
      storeRawComponents(db, second, [raw('Button')]);
      db.close();

      await saveDecisions({ sessionId: first, decisions: { accepted: ['Button'], rejected: [] } });

      expect(statuses(second).Button).not.toBe('generated');
    });

    it('closes the database even when saving fails', async () => {
      // a session with no components still saves; a database that cannot be written would throw, and the next open must work
      const sessionId = newSession();
      await saveDecisions({ sessionId, decisions: { accepted: [], rejected: [] } });
      expect(() => openPipelineDb().close()).not.toThrow();
    });
  });

  describe('prepareMapTokens', () => {
    const seedGenerated = (sessionId: string, withDesignProp: boolean): void => {
      const db = openPipelineDb();
      try {
        storeCDFComponents(db, sessionId, [
          {
            key: 'Card',
            entry: {
              $type: 'component',
              $properties: withDesignProp
                ? { background: designProp }
                : { title: { $type: 'string', $category: 'content' } },
            },
          },
        ]);
      } finally {
        db.close();
      }
    };

    it('copies the token session into the generated session and says mapping is worth running', async () => {
      const tokenSession = newSession();
      const generated = newSession();
      const db = openPipelineDb();
      storeDTCGTokens(db, tokenSession, [], [token('colors.primary'), token('colors.secondary')]);
      db.close();
      seedGenerated(generated, true);

      const plan = await prepareMapTokens({ tokenSessionId: tokenSession, tokensPath: '' }, generated);

      expect(plan).toEqual({ eligible: true, mappablePropCount: 1, rawTokenCount: 2 });
      const check = openPipelineDb();
      expect(loadDTCGTokens(check, generated).tokens).toHaveLength(2);
      check.close();
    });

    it('leaves the token session itself in place, since saving and pushing read it', async () => {
      const tokenSession = newSession();
      const generated = newSession();
      const db = openPipelineDb();
      storeDTCGTokens(db, tokenSession, [], [token('colors.primary')]);
      db.close();
      seedGenerated(generated, true);

      await prepareMapTokens({ tokenSessionId: tokenSession, tokensPath: '' }, generated);

      const check = openPipelineDb();
      expect(loadDTCGTokens(check, tokenSession).tokens).toHaveLength(1);
      check.close();
    });

    it('restores a reused tokens.json into the generated session when there is no token session', async () => {
      const generated = newSession();
      seedGenerated(generated, true);
      const tokensPath = join(dir, 'tokens.json');
      await writeFile(tokensPath, JSON.stringify({ colors: { primary: { $type: 'color', $value: '#06f' } } }));

      const plan = await prepareMapTokens({ tokenSessionId: null, tokensPath }, generated);

      expect(plan).toEqual({ eligible: true, mappablePropCount: 1, rawTokenCount: 1 });
    });

    it('is not worth running when there are no design props that are tokens', async () => {
      const tokenSession = newSession();
      const generated = newSession();
      const db = openPipelineDb();
      storeDTCGTokens(db, tokenSession, [], [token('colors.primary')]);
      db.close();
      seedGenerated(generated, false);

      const plan = await prepareMapTokens({ tokenSessionId: tokenSession, tokensPath: '' }, generated);

      expect(plan).toEqual({ eligible: false, mappablePropCount: 0, rawTokenCount: 1 });
    });

    it('is not worth running when there are no tokens', async () => {
      const generated = newSession();
      seedGenerated(generated, true);

      const plan = await prepareMapTokens({ tokenSessionId: null, tokensPath: '' }, generated);

      expect(plan).toEqual({ eligible: false, mappablePropCount: 1, rawTokenCount: 0 });
    });

    it('fails with a readable message when a reused tokens.json is missing, instead of exiting the process', async () => {
      const generated = newSession();
      seedGenerated(generated, true);

      await expect(
        prepareMapTokens({ tokenSessionId: null, tokensPath: join(dir, 'nope.json') }, generated),
      ).rejects.toThrow(/file not found/);
    });
  });
});
