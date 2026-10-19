import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOrCreateSession,
  openPipelineDb,
  storeRawComponents,
  type AgentAuthStatus,
  type RunExtractAndComposeSessionResponse,
  type RunGenerateComponentsSessionResponse,
} from '@contentful/experience-design-system-backend-pipeline';
import { runExtraction, type ExtractionDeps } from '../../src/tui/import/steps/06-extraction/run.js';
import type { ExtractionInput } from '../../src/tui/import/steps/06-extraction/types.js';
import { loadScopeGate } from '../../src/tui/import/steps/07-scope-gate/load.js';
import { runGeneration, type GenerationDeps } from '../../src/tui/import/steps/08-generation/run.js';

// This test reads top to bottom as the first half of an import: extraction finds the components, the scope gate loads
// them for the user to accept or reject, and generation turns the accepted ones into definitions and hands the result
// to the review and save/push flow. Each stage is given what the stage before it really returned. Only the outside
// world is faked (the agent CLI, the Contentful API, the generation subprocess); the pipeline database is real.
//
// What it does not cover: the screens, and the flow after the hand-off (review, save, preview, push).

const component = (name: string, slots: Array<{ name: string; allowedComponents?: string[] }> = []) => ({
  name,
  source: `src/${name}.tsx`,
  framework: 'react' as const,
  props: [],
  slots: slots.map((slot) => ({
    name: slot.name,
    isDefault: false,
    ...(slot.allowedComponents ? { allowedComponents: slot.allowedComponents } : {}),
  })),
});

describe('an import, from extraction to the hand-off to the review', () => {
  let dir: string;
  let previousDbPath: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'import-walkthrough-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    await writeFile(join(dir, 'tokens.json'), '{}');
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  // The extractor stores what it found in the pipeline database and returns the session it created. The fake does the
  // same, so the scope gate has something real to read.
  const extractionDeps = (): ExtractionDeps => ({
    checkAgentAuth: vi.fn().mockResolvedValue('authenticated'),
    fetchEntities: vi.fn(async () => join(dir, '.existing-entities.json')),
    runExtractAndComposeSession: vi.fn(async (request) => {
      const db = openPipelineDb();
      try {
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        storeRawComponents(db, sessionId, [
          component('Page', [{ name: 'content', allowedComponents: ['Card', 'Button'] }]),
          component('Card', [{ name: 'footer', allowedComponents: ['Button'] }]),
          component('Button'),
          component('Spacer'),
        ]);
        await request.onSessionCreated?.(sessionId);
        return {
          sessionId,
          compositionPhase: 'done',
          components: [{ name: 'Page' }, { name: 'Card' }, { name: 'Button' }, { name: 'Spacer' }],
          warnings: [],
          conflicts: [],
          compositionWarnings: [],
          scannedFileCount: 4,
          sourceCallSiteEvidence: [],
          sourceCallSiteRejections: [],
        } as unknown as RunExtractAndComposeSessionResponse;
      } finally {
        db.close();
      }
    }) as ExtractionDeps['runExtractAndComposeSession'],
    runGenerateTokensSession: vi.fn(async () => ({
      tokensPath: join(dir, 'tokens.json'),
      tokenSessionId: null,
      tokenCount: 0,
      warnings: [],
    })) as unknown as ExtractionDeps['runGenerateTokensSession'],
    runSelection: vi.fn(async () => {}),
  });

  const extractionInput = (): ExtractionInput => ({
    projectPath: dir,
    filePaths: [join(dir, 'src', 'Page.tsx')],
    rawTokensPath: join(dir, 'raw-tokens.json'),
    tokenStrategy: 'generate',
    credentials: { spaceId: 'space', environmentId: 'master', cmaToken: 'token', host: 'api.contentful.com' },
    agent: 'claude',
    promptOverrides: [],
    noCache: false,
  });

  // Generation runs the agent in-process, then (when there are tokens to map) the token mapper. The fakes stand in for
  // both, and answer the way a successful run does.
  const generationFakes = (sessionId: string, accepted: string[]) => {
    const response: RunGenerateComponentsSessionResponse = {
      sessionId,
      results: accepted.map((componentName) => ({
        componentName,
        classified: 1,
        excluded: 0,
        slots: 0,
        warnings: [],
        failed: false,
        cached: false,
        renamedSlotsCount: 0,
      })),
      allOk: true,
      renamedSlotsCount: 0,
      duplicateNames: [],
      droppedAllowedComponents: [],
      emptySession: false,
    };
    return {
      checkAgentAuth: vi.fn(async (): Promise<AgentAuthStatus> => 'ok'),
      saveDecisions: vi.fn(async () => {}),
      runGenerate: vi.fn(async () => response) as GenerationDeps['runGenerate'],
      prepareMapTokens: vi.fn(async () => ({
        eligible: false as const,
      })) as unknown as GenerationDeps['prepareMapTokens'],
      prepareMapOptions: vi.fn<GenerationDeps['prepareMapOptions']>(async () => ({})),
      runMapTokens: vi.fn() as GenerationDeps['runMapTokens'],
    } satisfies GenerationDeps;
  };

  it('carries the components the user accepts through generation and hands over a session to review', async () => {
    // 1. Extraction finds four components and hands back the session they were stored in.
    const extraction = await runExtraction(extractionInput(), () => {}, extractionDeps());
    if (!extraction.ok) throw new Error(`extraction failed: ${extraction.message}`);
    const { sessionId } = extraction.extraction;
    expect(sessionId).toBeTruthy();

    // 2. The scope gate reads those components from the database, so the user can decide which to keep.
    const gate = loadScopeGate(sessionId);
    if (!gate.ok) throw new Error(`scope gate failed: ${gate.message}`);
    expect(gate.components.map((c) => c.name).sort()).toEqual(['Button', 'Card', 'Page', 'Spacer']);

    // 3. The user keeps three and drops Spacer. Generation saves that decision, generates the definitions for the
    //    accepted components with the agent, and hands the result on.
    const generationDeps = generationFakes(sessionId, ['Page', 'Card', 'Button']);

    const generation = await runGeneration(
      {
        sessionId,
        decisions: { accepted: ['Page', 'Card', 'Button'], rejected: ['Spacer'] },
        cachedNames: Promise.resolve([]),
        tokensPath: extraction.extraction.tokensPath,
        tokenSessionId: extraction.extraction.tokenSessionId,
        existingEntitiesPath: extraction.extraction.existingEntitiesPath,
        agent: 'claude',
        promptOverrides: [],
        noCache: false,
        hasTokens: false,
      },
      () => {},
      generationDeps,
    );

    // 4. The flow gets what it needs to start the review: the route, the session and how many components to expect.
    if (!generation.ok) throw new Error(`generation failed: ${generation.message}`);
    expect(generation.generation).toMatchObject({ route: 'review', acceptedCount: 3 });
    expect(generationDeps.saveDecisions).toHaveBeenCalledWith({
      sessionId,
      decisions: { accepted: ['Page', 'Card', 'Button'], rejected: ['Spacer'] },
    });
    expect(generationDeps.prepareMapOptions).not.toHaveBeenCalled();
  });

  it('stops at the first stage that fails and says which one, instead of carrying on with nothing', async () => {
    const deps = extractionDeps();
    deps.checkAgentAuth = vi.fn().mockResolvedValue('unauthenticated');

    const extraction = await runExtraction(extractionInput(), () => {}, deps);

    expect(extraction.ok).toBe(false);
    expect(extraction.ok ? '' : extraction.step).toBe('claude auth check');
    expect(deps.runExtractAndComposeSession).not.toHaveBeenCalled();
  });

  it('stops at extraction with a message when the project has no components', async () => {
    const deps = extractionDeps();
    deps.runExtractAndComposeSession = vi.fn(async (request) => {
      await request.onSessionCreated?.('empty-session');
      return {
        sessionId: 'empty-session',
        compositionPhase: 'done',
        components: [],
      } as unknown as RunExtractAndComposeSessionResponse;
    }) as ExtractionDeps['runExtractAndComposeSession'];

    const extraction = await runExtraction(extractionInput(), () => {}, deps);

    expect(extraction).toMatchObject({
      ok: false,
      step: 'analyze extract',
      message: expect.stringContaining('No components'),
    });
  });

  it('tells the user so, instead of showing an empty list, when the database holds nothing for the session', async () => {
    // Extraction reports a component, but nothing was stored for the session (for example, a failed write). The scope
    // gate is the last line of defence before the user is shown a blank list.
    const deps = extractionDeps();
    deps.runExtractAndComposeSession = vi.fn(async (request) => {
      const db = openPipelineDb();
      try {
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        await request.onSessionCreated?.(sessionId);
        return {
          sessionId,
          compositionPhase: 'done',
          components: [{ name: 'Button' }],
          warnings: [],
          conflicts: [],
          compositionWarnings: [],
          scannedFileCount: 1,
          sourceCallSiteEvidence: [],
          sourceCallSiteRejections: [],
        } as unknown as RunExtractAndComposeSessionResponse;
      } finally {
        db.close();
      }
    }) as ExtractionDeps['runExtractAndComposeSession'];

    const extraction = await runExtraction(extractionInput(), () => {}, deps);
    if (!extraction.ok) throw new Error(`extraction failed: ${extraction.message}`);

    expect(loadScopeGate(extraction.extraction.sessionId)).toEqual({
      ok: false,
      message: 'No components found for this session. Please run the import again.',
    });
  });

  it('skips generation and the review entirely when the user accepts nothing', async () => {
    const extraction = await runExtraction(extractionInput(), () => {}, extractionDeps());
    if (!extraction.ok) throw new Error(`extraction failed: ${extraction.message}`);
    const deps = generationFakes(extraction.extraction.sessionId, []);

    const generation = await runGeneration(
      {
        sessionId: extraction.extraction.sessionId,
        decisions: { accepted: [], rejected: ['Page', 'Card', 'Button', 'Spacer'] },
        cachedNames: Promise.resolve([]),
        tokensPath: extraction.extraction.tokensPath,
        tokenSessionId: null,
        existingEntitiesPath: null,
        agent: 'claude',
        promptOverrides: [],
        noCache: false,
        hasTokens: false,
      },
      () => {},
      deps,
    );

    expect(generation).toEqual({ ok: true, generation: { route: 'push', acceptedCount: 0 } });
    expect(deps.runGenerate).not.toHaveBeenCalled();
    expect(deps.prepareMapOptions).not.toHaveBeenCalled();
  });
});
