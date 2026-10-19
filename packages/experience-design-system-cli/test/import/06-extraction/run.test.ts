import { describe, expect, it, vi } from 'vitest';
import type {
  RunExtractAndComposeSessionRequest,
  RunExtractAndComposeSessionResponse,
} from '@contentful/experience-design-system-backend-pipeline';
import { runExtraction, type ExtractionDeps } from '../../../src/tui/import/steps/06-extraction/run.js';
import type { ExtractionInput, ExtractionProgress } from '../../../src/tui/import/steps/06-extraction/types.js';

const input = (overrides: Partial<ExtractionInput> = {}): ExtractionInput => ({
  projectPath: '/proj',
  filePaths: ['/proj/src/a.tsx', '/proj/src/b.tsx', '/proj/src/c.tsx'],
  rawTokensPath: '/raw-tokens.json',
  tokenStrategy: 'generate',
  credentials: { spaceId: 's', environmentId: 'e', cmaToken: 't', host: 'api.contentful.com' },
  agent: 'claude',
  promptOverrides: [],
  noCache: false,
  ...overrides,
});

type Session = (req: RunExtractAndComposeSessionRequest) => Promise<RunExtractAndComposeSessionResponse>;

const successResponse = (
  overrides: Partial<RunExtractAndComposeSessionResponse> = {},
): RunExtractAndComposeSessionResponse => ({
  sessionId: 'sess-1',
  compositionPhase: 'done',
  components: [
    { name: 'A', framework: 'react', source: 'a.tsx', props: [], slots: [] } as never,
    { name: 'B' } as never,
    { name: 'C' } as never,
  ],
  warnings: [],
  conflicts: [],
  compositionWarnings: [],
  scannedFileCount: 3,
  sourceCallSiteEvidence: [],
  sourceCallSiteRejections: [],
  ...overrides,
});

/** Default-success deps; each test overrides the one thing it is about. */
function makeDeps(overrides: Partial<ExtractionDeps> = {}, log: string[] = []): ExtractionDeps {
  const defaultSession: Session = async (req) => {
    log.push('extract:start');
    req.onProgress?.({ kind: 'extract', done: 3, total: 3, componentsSoFar: 3 });
    req.onProgress?.({ kind: 'composition', phase: 'agent:claude' });
    await req.onSessionCreated?.('sess-1');
    log.push('extract:session');
    req.onProgress?.({ kind: 'composition', phase: 'done' });
    log.push('extract:exit');
    return successResponse();
  };
  return {
    checkAgentAuth: vi.fn().mockResolvedValue('authenticated'),
    fetchEntities: vi.fn(async () => {
      log.push('entities:start');
      log.push('entities:done');
      return '/proj/.contentful/.existing-entities.json';
    }),
    runExtractAndComposeSession: vi.fn(defaultSession) as ExtractionDeps['runExtractAndComposeSession'],
    runGenerateTokensSession: vi.fn(async () => {
      log.push('tokens:start');
      return {
        tokensPath: '/proj/.contentful/tokens.json',
        tokenSessionId: 'tok-1',
        tokenCount: 12,
        warnings: [],
      };
    }) as ExtractionDeps['runGenerateTokensSession'],
    runSelection: vi.fn(async () => {
      log.push('selection');
    }),
    ...overrides,
  };
}

describe('runExtraction — the tokens path it hands over', () => {
  const tokensPathOf = async (overrides: Partial<ExtractionInput>): Promise<string | undefined> => {
    const result = await runExtraction(input(overrides), () => {}, makeDeps());
    return result.ok ? result.extraction.tokensPath : undefined;
  };

  it('is the generated catalog when tokens were generated', async () => {
    expect(await tokensPathOf({})).toBe('/proj/.contentful/tokens.json');
  });

  it('is the existing catalog when it was reused, since that file is already there', async () => {
    expect(await tokensPathOf({ tokenStrategy: 'reuse' })).toBe('/proj/.contentful/tokens.json');
  });

  it('is the existing catalog when it was reused even though there is no raw tokens file to generate from', async () => {
    // reuse is what sets the path here: nothing is generated, so it would otherwise count as having no token source
    const deps = makeDeps({ runGenerateTokensSession: vi.fn() });
    const result = await runExtraction(input({ rawTokensPath: '', tokenStrategy: 'reuse' }), () => {}, deps);
    expect(result.ok && result.extraction.tokensPath).toBe('/proj/.contentful/tokens.json');
    expect(deps.runGenerateTokensSession).not.toHaveBeenCalled();
  });

  it('is empty when there is no token source at all, so later steps do not look for a file that does not exist', async () => {
    const deps = makeDeps({ runGenerateTokensSession: vi.fn() });
    const result = await runExtraction(input({ rawTokensPath: '' }), () => {}, deps);
    expect(result.ok && result.extraction.tokensPath).toBe('');
    expect(deps.runGenerateTokensSession).not.toHaveBeenCalled();
  });

  it('has no token session or tokens counted when there is no token source', async () => {
    const result = await runExtraction(input({ rawTokensPath: '' }), () => {}, makeDeps());
    expect(result.ok && result.extraction).toMatchObject({ tokenSessionId: null, tokenCount: 0 });
  });
});

describe('runExtraction — the happy path', () => {
  it('hands the wizard everything it needs to start at the scope gate', async () => {
    const result = await runExtraction(input(), () => {}, makeDeps());

    expect(result).toEqual({
      ok: true,
      extraction: {
        sessionId: 'sess-1',
        outDir: '/proj/.contentful',
        tokensPath: '/proj/.contentful/tokens.json',
        tokenSessionId: 'tok-1',
        tokenCount: 12,
        existingEntitiesPath: '/proj/.contentful/.existing-entities.json',
        existingEntitiesStatus: 'complete',
        compositionPhase: 'done',
      },
    });
  });

  it('reports the composition cache hit to the wizard', async () => {
    const deps = makeDeps({
      runExtractAndComposeSession: vi.fn(async (req) => {
        await req.onSessionCreated?.('sess-1');
        return successResponse({ compositionPhase: 'cache-hit' });
      }) as ExtractionDeps['runExtractAndComposeSession'],
    });
    const result = await runExtraction(input(), () => {}, deps);
    expect(result.ok && result.extraction.compositionPhase).toBe('cache-hit');
  });

  it('shows every job on the first frame and ends with each one finished', async () => {
    const frames: ExtractionProgress[] = [];
    await runExtraction(input(), (progress) => frames.push(progress), makeDeps());

    expect(frames[0]).toMatchObject({
      selection: 'running',
      existingEntities: 'running',
      tokens: 'running',
      composition: 'resolving',
    });
    expect(frames.at(-1)).toMatchObject({
      selection: 'complete',
      existingEntities: 'complete',
      tokens: 'complete',
      composition: 'done',
      scan: { scanned: 3, total: 3 },
    });
  });
});

describe('runExtraction — ordering', () => {
  it('starts selection as soon as onSessionCreated fires, while extraction is still running', async () => {
    // The orchestrator mock holds the extraction promise open until selection has run.
    // If selection only began after extract returned, this would never be released and the run would hang.
    let selectionStarted: () => void = () => {};
    const selectionRan = new Promise<void>((resolve) => (selectionStarted = resolve));
    const log: string[] = [];
    const deps = makeDeps(
      {
        runSelection: vi.fn(async () => {
          log.push('selection');
          selectionStarted();
        }),
        runExtractAndComposeSession: vi.fn(async (req) => {
          await req.onSessionCreated?.('sess-1');
          await selectionRan;
          log.push('extract:exit');
          return successResponse();
        }) as ExtractionDeps['runExtractAndComposeSession'],
      },
      log,
    );

    const result = await Promise.race([
      runExtraction(input(), () => {}, deps),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 2000)),
    ]);

    expect(result).not.toBe('hung');
    expect(log.indexOf('selection')).toBeLessThan(log.indexOf('extract:exit'));
  });

  it('makes selection wait for the entities fetch', async () => {
    const log: string[] = [];
    let finishFetch: (path: string | null) => void = () => {};
    const deps = makeDeps(
      {
        fetchEntities: vi.fn(
          () =>
            new Promise<string | null>((resolve) => {
              log.push('entities:start');
              finishFetch = (path) => {
                log.push('entities:done');
                resolve(path);
              };
            }),
        ),
      },
      log,
    );

    const running = runExtraction(input(), () => {}, deps);
    await new Promise((r) => setTimeout(r, 20));
    expect(log).not.toContain('selection');

    finishFetch('/proj/.contentful/.existing-entities.json');
    await running;
    expect(log.indexOf('selection')).toBeGreaterThan(log.indexOf('entities:done'));
  });

  it('starts the entities fetch before it starts extracting', async () => {
    const log: string[] = [];
    await runExtraction(input(), () => {}, makeDeps({}, log));
    expect(log.indexOf('entities:start')).toBeLessThan(log.indexOf('extract:start'));
  });

  it('runs token generation at the same time as extraction', async () => {
    const log: string[] = [];
    await runExtraction(input(), () => {}, makeDeps({}, log));
    expect(log.indexOf('tokens:start')).toBeLessThan(log.indexOf('extract:exit'));
  });
});

describe('runExtraction — what is skipped', () => {
  it('skips the entities fetch and keeps the status idle when credentials were skipped', async () => {
    const deps = makeDeps();
    const result = await runExtraction(input({ credentials: null }), () => {}, deps);

    expect(deps.fetchEntities).not.toHaveBeenCalled();
    expect(result.ok && result.extraction.existingEntitiesStatus).toBe('idle');
    expect(result.ok && result.extraction.existingEntitiesPath).toBeNull();
  });

  it('does not wait for any fetch before selecting when credentials were skipped', async () => {
    const deps = makeDeps();
    await runExtraction(input({ credentials: null }), () => {}, deps);
    expect(deps.runSelection).toHaveBeenCalledTimes(1);
  });

  it('does not generate tokens when they are being reused', async () => {
    const deps = makeDeps();
    const result = await runExtraction(input({ tokenStrategy: 'reuse' }), () => {}, deps);

    expect(deps.runGenerateTokensSession).not.toHaveBeenCalled();
    expect(result.ok && result.extraction.tokenSessionId).toBeNull();
  });

  it('does not generate tokens when no raw tokens file was given', async () => {
    const deps = makeDeps();
    await runExtraction(input({ rawTokensPath: '' }), () => {}, deps);
    expect(deps.runGenerateTokensSession).not.toHaveBeenCalled();
  });

  it('forces the token cache off for a regenerate, and only for a regenerate', async () => {
    const regenerate = makeDeps();
    await runExtraction(input({ tokenStrategy: 'regenerate' }), () => {}, regenerate);
    expect(regenerate.runGenerateTokensSession).toHaveBeenCalledWith(expect.objectContaining({ noCache: true }));

    const normal = makeDeps();
    await runExtraction(input({ tokenStrategy: 'generate' }), () => {}, normal);
    expect(normal.runGenerateTokensSession).toHaveBeenCalledWith(expect.objectContaining({ noCache: false }));
  });

  it('passes the cache setting to extraction and selection', async () => {
    const deps = makeDeps();
    await runExtraction(input({ noCache: true, promptOverrides: ['x=y'] }), () => {}, deps);
    expect(deps.runExtractAndComposeSession).toHaveBeenCalledWith(
      expect.objectContaining({ noCache: true, promptOverrides: ['x=y'] }),
    );
    expect(deps.runSelection).toHaveBeenCalledWith(expect.objectContaining({ noCache: true }));
  });
});

describe('runExtraction — failures', () => {
  it.each(['not-found', 'unauthenticated'] as const)(
    'stops before doing any work when the agent is %s',
    async (status) => {
      const deps = makeDeps({ checkAgentAuth: vi.fn().mockResolvedValue(status) });
      const result = await runExtraction(input(), () => {}, deps);

      expect(result).toMatchObject({ ok: false, step: 'claude auth check' });
      expect(deps.runExtractAndComposeSession).not.toHaveBeenCalled();
      expect(deps.fetchEntities).not.toHaveBeenCalled();
    },
  );

  it('reports the extract error when the orchestrator throws', async () => {
    const deps = makeDeps({
      runExtractAndComposeSession: vi.fn(async () => {
        throw new Error('source directory does not exist');
      }) as ExtractionDeps['runExtractAndComposeSession'],
    });
    expect(await runExtraction(input(), () => {}, deps)).toEqual({
      ok: false,
      step: 'analyze extract',
      message: 'source directory does not exist',
    });
  });

  it('reports no components found when the count is zero', async () => {
    const deps = makeDeps({
      runExtractAndComposeSession: vi.fn(async (req) => {
        await req.onSessionCreated?.('sess-1');
        return successResponse({ components: [] });
      }) as ExtractionDeps['runExtractAndComposeSession'],
    });
    const result = await runExtraction(input(), () => {}, deps);
    expect(result).toMatchObject({ ok: false, step: 'analyze extract' });
    expect(!result.ok && result.message).toContain('No components found in /proj.');
  });

  it('reports a selection failure', async () => {
    const deps = makeDeps({ runSelection: vi.fn().mockRejectedValue(new Error('selection agent timed out')) });
    expect(await runExtraction(input(), () => {}, deps)).toEqual({
      ok: false,
      step: 'selection agent',
      message: 'selection agent timed out',
    });
  });

  it('reports a token generation failure with the step that failed', async () => {
    const deps = makeDeps({
      runGenerateTokensSession: vi.fn(async () => {
        throw new Error('disk full');
      }) as ExtractionDeps['runGenerateTokensSession'],
    });
    expect(await runExtraction(input(), () => {}, deps)).toEqual({
      ok: false,
      step: 'generate tokens',
      message: 'disk full',
    });
  });

  it('treats a failed entities fetch as unavailable and carries on', async () => {
    const deps = makeDeps({ fetchEntities: vi.fn().mockResolvedValue(null) });
    const result = await runExtraction(input(), () => {}, deps);
    expect(result.ok && result.extraction.existingEntitiesStatus).toBe('failed');
    expect(result.ok && result.extraction.existingEntitiesPath).toBeNull();
  });

  describe('when more than one thing fails, the user sees the first of: extract, no components, selection, tokens', () => {
    const everythingFails = (overrides: Partial<ExtractionDeps>): ExtractionDeps =>
      makeDeps({
        runSelection: vi.fn().mockRejectedValue(new Error('selection broke')),
        runGenerateTokensSession: vi.fn(async () => {
          throw new Error('tokens broke');
        }) as ExtractionDeps['runGenerateTokensSession'],
        ...overrides,
      });

    it('extract beats everything', async () => {
      const deps = everythingFails({
        runExtractAndComposeSession: vi.fn(async () => {
          throw new Error('extract broke');
        }) as ExtractionDeps['runExtractAndComposeSession'],
      });
      expect(await runExtraction(input(), () => {}, deps)).toMatchObject({
        step: 'analyze extract',
        message: 'extract broke',
      });
    });

    it('no components beats selection and tokens', async () => {
      const deps = everythingFails({
        runExtractAndComposeSession: vi.fn(async (req) => {
          await req.onSessionCreated?.('sess-1');
          return successResponse({ components: [] });
        }) as ExtractionDeps['runExtractAndComposeSession'],
      });
      expect(await runExtraction(input(), () => {}, deps)).toMatchObject({ step: 'analyze extract' });
    });

    it('selection beats tokens', async () => {
      expect(await runExtraction(input(), () => {}, everythingFails({}))).toMatchObject({
        step: 'selection agent',
        message: 'selection broke',
      });
    });
  });
});
