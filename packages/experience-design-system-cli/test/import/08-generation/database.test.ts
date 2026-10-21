import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOrCreateSession,
  getRefineSessionPaths,
  loadAcceptedNames,
  loadComponentReviewMetadata,
  loadDTCGTokens,
  openPipelineDb,
  storeDTCGTokens,
  storeRawComponents,
  writeScopeDecisionsSnapshot,
} from '@contentful/experience-design-system-backend-pipeline';
import { seedCompleteDefinitions } from '../source-session-fixture.js';
import { prepareMapTokens } from '../../../src/tui/import/steps/08-generation/map-tokens.js';
import { saveDecisions } from '../../../src/tui/import/steps/08-generation/save-decisions.js';
import { runGeneration, type GenerationDeps } from '../../../src/tui/import/steps/08-generation/run.js';

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
  let previousArtifactsDir: string | undefined;

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
    previousArtifactsDir = process.env.EDS_REVIEW_ARTIFACTS_DIR;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    process.env.EDS_REVIEW_ARTIFACTS_DIR = join(dir, 'reviews');
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    if (previousArtifactsDir === undefined) delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
    else process.env.EDS_REVIEW_ARTIFACTS_DIR = previousArtifactsDir;
    await rm(dir, { recursive: true, force: true });
  });

  describe('saveDecisions', () => {
    it.each([true, false])(
      'stops generation when the real snapshot filesystem write fails, accepted=%s',
      async (accepted) => {
        const sessionId = newSession();
        const db = openPipelineDb();
        storeRawComponents(db, sessionId, [raw('Card')]);
        db.close();
        const blockedPath = join(dir, 'blocked-artifacts');
        await writeFile(blockedPath, 'not a directory');
        process.env.EDS_REVIEW_ARTIFACTS_DIR = blockedPath;
        const auth = vi.fn();
        const generate = vi.fn();
        const deps: GenerationDeps = {
          saveDecisions,
          checkAgentAuth: auth,
          runGenerate: generate,
          prepareMapTokens: vi.fn(),
          prepareMapOptions: vi.fn(),
          runMapTokens: vi.fn(),
        };
        const result = await runGeneration(
          {
            sessionId,
            decisions: { accepted: accepted ? ['Card'] : [], rejected: accepted ? [] : ['Card'] },
            cachedNames: Promise.resolve([]),
            tokensPath: '',
            tokenSessionId: null,
            existingEntitiesPath: null,
            agent: 'claude',
            promptOverrides: [],
            noCache: true,
            hasTokens: false,
          },
          () => {},
          deps,
        );
        expect(result).toMatchObject({ ok: false, step: 'save decisions' });
        expect(auth).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
        expect(statuses(sessionId)).toEqual({ Card: accepted ? 'generated' : 'rejected' });
      },
    );

    it('marks the partition, writes authoritative provenance, and reads it through review consumers', async () => {
      const sessionId = newSession();
      const db = openPipelineDb();
      const button = {
        ...raw('Button'),
        factSchemaVersion: 3,
        sourceCandidates: [
          {
            name: '__proto__',
            keyPath: ['__proto__'],
            evidenceKinds: ['declaration'],
            type: "'on' | string",
            declaredRequired: false,
            sourceDefault: null,
            facts: null,
            observations: [],
            projection: { kind: 'excluded', reason: 'source-candidate-only' },
          },
        ],
      };
      storeRawComponents(db, sessionId, [button, raw('Card'), raw('Helper')]);
      db.close();

      const decisions = {
        accepted: ['Button', 'Card'],
        rejected: ['Helper'],
        acceptedProvenance: {
          Button: { kind: 'direct' as const, roots: ['Button'] },
          Card: { kind: 'closure' as const, roots: ['Button'] },
        },
      };
      await saveDecisions({ sessionId, decisions });

      expect(statuses(sessionId)).toEqual({ Button: 'generated', Card: 'generated', Helper: 'rejected' });

      const check = openPipelineDb();
      try {
        expect(loadComponentReviewMetadata(check, sessionId, 'Card')?.scopeProvenance).toEqual({
          kind: 'closure',
          roots: ['Button'],
        });
        check
          .prepare("UPDATE raw_components SET status = 'rejected' WHERE session_id = ? AND name = 'Button'")
          .run(sessionId);
        await writeScopeDecisionsSnapshot(check, sessionId);
      } finally {
        check.close();
      }

      const paths = await getRefineSessionPaths(sessionId, join(dir, 'reviews'));
      const snapshot = JSON.parse(await readFile(paths.statePath, 'utf8')) as {
        components: Array<{
          name: string;
          status: string;
          scopeProvenance?: unknown;
          originalProposal?: { sourceCandidates?: Array<{ name: string; keyPath: string[] }> };
        }>;
      };
      expect(snapshot.components.find((item) => item.name === 'Button')).toMatchObject({
        status: 'accepted',
        scopeProvenance: { kind: 'direct', roots: ['Button'] },
        originalProposal: { sourceCandidates: [{ name: '__proto__', keyPath: ['__proto__'] }] },
      });
      expect(await loadAcceptedNames(sessionId)).toEqual(new Set(['Button', 'Card']));
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

    it('closes the database when an incomplete partition is rejected', async () => {
      const sessionId = newSession();
      const db = openPipelineDb();
      storeRawComponents(db, sessionId, [raw('Button')]);
      db.close();

      await expect(saveDecisions({ sessionId, decisions: { accepted: [], rejected: [] } })).rejects.toThrow(
        'omit component',
      );
      const reopened = openPipelineDb();
      expect(
        reopened.prepare('SELECT COUNT(*) AS count FROM raw_components WHERE session_id = ?').get(sessionId),
      ).toEqual({
        count: 1,
      });
      reopened.close();
    });
  });

  describe('prepareMapTokens', () => {
    const seedGenerated = async (sessionId: string, withDesignProp: boolean): Promise<void> => {
      const db = openPipelineDb();
      try {
        await seedCompleteDefinitions(db, sessionId, dir, [
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
      await seedGenerated(generated, true);

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
      await seedGenerated(generated, true);

      await prepareMapTokens({ tokenSessionId: tokenSession, tokensPath: '' }, generated);

      const check = openPipelineDb();
      expect(loadDTCGTokens(check, tokenSession).tokens).toHaveLength(1);
      check.close();
    });

    it('restores a reused tokens.json into the generated session when there is no token session', async () => {
      const generated = newSession();
      await seedGenerated(generated, true);
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
      await seedGenerated(generated, false);

      const plan = await prepareMapTokens({ tokenSessionId: tokenSession, tokensPath: '' }, generated);

      expect(plan).toEqual({ eligible: false, mappablePropCount: 0, rawTokenCount: 1 });
    });

    it('is not worth running when there are no tokens', async () => {
      const generated = newSession();
      await seedGenerated(generated, true);

      const plan = await prepareMapTokens({ tokenSessionId: null, tokensPath: '' }, generated);

      expect(plan).toEqual({ eligible: false, mappablePropCount: 1, rawTokenCount: 0 });
    });

    it('fails with a readable message when a reused tokens.json is missing, instead of exiting the process', async () => {
      const generated = newSession();
      await seedGenerated(generated, true);

      await expect(
        prepareMapTokens({ tokenSessionId: null, tokensPath: join(dir, 'nope.json') }, generated),
      ).rejects.toThrow(/file not found/);
    });
  });
});
