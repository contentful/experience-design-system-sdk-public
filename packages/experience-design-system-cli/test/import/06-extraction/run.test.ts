import { describe, expect, it, vi } from 'vitest';
import type {
  RunExtractAndComposeSessionRequest,
  RunExtractAndComposeSessionResponse,
} from '@contentful/experience-design-system-backend-pipeline';
import { runExtraction, type ExtractionDeps } from '../../../src/tui/import/steps/06-extraction/run.js';
import type { ExtractionInput, ExtractionProgress } from '../../../src/tui/import/steps/06-extraction/types.js';

vi.mock('../../../src/tui/import/steps/06-extraction/find-skill-path.js', () => ({
  findSkillPath: (fileName: string) => `/test-skills/${fileName}`,
}));

const input = (overrides: Partial<ExtractionInput> = {}): ExtractionInput => ({
  projectPath: '/proj',
  filePaths: ['/proj/src/a.tsx', '/proj/src/b.tsx', '/proj/src/c.tsx'],
  rawTokensPath: '/raw-tokens.json',
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
  sourceEvidenceHandle: {
    envelopeId: 'source-env',
    digest: 'digest',
    extractionStepId: 1,
    coverage: 'unavailable',
    readiness: 'ready',
  },
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
  it('forwards the settled optional model path to selection', async () => {
    const deps = makeDeps();
    const result = await runExtraction(input({ noCache: true }), () => {}, deps);
    expect(result.ok).toBe(true);
    expect(deps.runSelection).toHaveBeenCalledWith(
      expect.objectContaining({ existingEntitiesPath: '/proj/.contentful/.existing-entities.json' }),
    );
  });

  it('keeps one live attempt signal through extraction, selection, and token generation', async () => {
    const controller = new AbortController();
    const withSignal = input() as ExtractionInput & { signal?: AbortSignal };
    withSignal.signal = controller.signal;
    const signals: Array<AbortSignal | undefined> = [];
    const deps = makeDeps({
      runExtractAndComposeSession: vi.fn(async (req) => {
        signals.push((req as typeof req & { signal?: AbortSignal }).signal);
        await req.onSessionCreated?.('sess-1');
        return successResponse();
      }) as ExtractionDeps['runExtractAndComposeSession'],
      runGenerateTokensSession: vi.fn(async (req) => {
        signals.push((req as typeof req & { signal?: AbortSignal }).signal);
        return {
          tokensPath: '/proj/.contentful/tokens.json',
          tokenSessionId: 'tok-1',
          tokenCount: 12,
          warnings: [],
        };
      }) as ExtractionDeps['runGenerateTokensSession'],
      runSelection: vi.fn(async (req) => {
        signals.push((req as typeof req & { signal?: AbortSignal }).signal);
      }),
    });

    const result = await runExtraction(withSignal, () => {}, deps);

    expect(result.ok).toBe(true);
    expect(signals).toHaveLength(3);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals.every((signal) => signal === signals[0] && signal?.aborted === false)).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });

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
  it('starts selection once completed extraction returns, not from the early session notification', async () => {
    const log: string[] = [];
    const deps = makeDeps(
      {
        runSelection: vi.fn(async () => {
          log.push('selection');
        }),
        runExtractAndComposeSession: vi.fn(async (req) => {
          await req.onSessionCreated?.('sess-1');
          log.push('extract:exit');
          return successResponse();
        }) as ExtractionDeps['runExtractAndComposeSession'],
      },
      log,
    );

    const result = await runExtraction(input(), () => {}, deps);
    expect(result.ok).toBe(true);
    expect(log.indexOf('selection')).toBeGreaterThan(log.indexOf('extract:exit'));
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
    expect(deps.runSelection).toHaveBeenCalledWith(expect.objectContaining({ existingEntitiesPath: null }));
  });

  it('does not wait for any fetch before selecting when credentials were skipped', async () => {
    const deps = makeDeps();
    await runExtraction(input({ credentials: null }), () => {}, deps);
    expect(deps.runSelection).toHaveBeenCalledTimes(1);
  });

  it('does not generate tokens when no raw tokens file was given', async () => {
    const deps = makeDeps();
    await runExtraction(input({ rawTokensPath: '' }), () => {}, deps);
    expect(deps.runGenerateTokensSession).not.toHaveBeenCalled();
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
  it('does no preparation or session work for a pre-aborted attempt', async () => {
    const controller = new AbortController();
    controller.abort();
    const withSignal = input() as ExtractionInput & { signal?: AbortSignal };
    withSignal.signal = controller.signal;
    const deps = makeDeps();

    const result = await runExtraction(withSignal, () => {}, deps);

    expect(result).toMatchObject({ ok: false });
    expect(deps.checkAgentAuth).not.toHaveBeenCalled();
    expect(deps.fetchEntities).not.toHaveBeenCalled();
    expect(deps.runGenerateTokensSession).not.toHaveBeenCalled();
    expect(deps.runExtractAndComposeSession).not.toHaveBeenCalled();
    expect(deps.runSelection).not.toHaveBeenCalled();
  });

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
    expect(deps.runSelection).toHaveBeenCalledWith(expect.objectContaining({ existingEntitiesPath: null }));
    expect(result.ok && result.extraction.existingEntitiesPath).toBeNull();
    expect(deps.runSelection).toHaveBeenCalledWith(expect.objectContaining({ existingEntitiesPath: null }));
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

  it('cancels and drains token generation without launching selection when extraction fails first', async () => {
    const controller = new AbortController();
    const events: string[] = [];
    let releaseTokens!: () => void;
    const withSignal = input() as ExtractionInput & { signal?: AbortSignal };
    withSignal.signal = controller.signal;

    const deps = makeDeps({
      runGenerateTokensSession: vi.fn((req) => {
        const signal = (req as typeof req & { signal?: AbortSignal }).signal;
        return new Promise((resolve) => {
          releaseTokens = () => {
            events.push('tokens:drained');
            resolve({ tokenSessionId: 'tok-1', tokensPath: '/tokens.json', tokenCount: 1, warnings: [] });
          };
          signal?.addEventListener(
            'abort',
            () => {
              events.push('tokens:aborted');
              releaseTokens();
            },
            { once: true },
          );
        });
      }) as ExtractionDeps['runGenerateTokensSession'],
      runSelection: vi.fn(),
      runExtractAndComposeSession: vi.fn(async (req) => {
        await req.onSessionCreated?.('sess-1');
        throw new Error('original extraction failure');
      }) as ExtractionDeps['runExtractAndComposeSession'],
    });

    const result = await runExtraction(withSignal, () => {}, deps);
    const atReturn = [...events];
    releaseTokens?.();

    expect(result).toEqual({ ok: false, step: 'analyze extract', message: 'original extraction failure' });
    expect(atReturn).toContain('tokens:aborted');
    expect(atReturn).toContain('tokens:drained');
    expect(deps.runSelection).not.toHaveBeenCalled();
  });

  it('does not launch selection when cancellation happens during the entities wait', async () => {
    let resolveEntities!: (path: string | null) => void;
    const entities = new Promise<string | null>((resolve) => {
      resolveEntities = resolve;
    });
    const controller = new AbortController();
    const withSignal = input() as ExtractionInput & { signal?: AbortSignal };
    withSignal.signal = controller.signal;
    const deps = makeDeps({
      fetchEntities: vi.fn(() => entities),
    });

    const running = runExtraction(withSignal, () => {}, deps);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    resolveEntities('/entities.json');
    await running;

    expect(deps.runSelection).not.toHaveBeenCalled();
  });
});
