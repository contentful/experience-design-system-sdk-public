import { describe, expect, it, vi } from 'vitest';
import { runExtraction, type ExtractionDeps } from '../../../src/tui/import/steps/06-extraction/run.js';
import type { ExtractionInput, ExtractionProgress } from '../../../src/tui/import/steps/06-extraction/types.js';

const input = (overrides: Partial<ExtractionInput> = {}): ExtractionInput => ({
  projectPath: '/proj',
  rawTokensPath: '/raw-tokens.json',
  tokenStrategy: 'generate',
  credentials: { spaceId: 's', environmentId: 'e', cmaToken: 't', host: 'api.contentful.com' },
  agent: 'claude',
  promptOverrides: [],
  noCache: false,
  ...overrides,
});

type Handlers = { onStderrLine: (line: string) => void; onStdoutLine: (line: string) => void };

/** Deps that succeed; each test overrides the one thing it is about. The log records the order things happened in. */
function makeDeps(overrides: Partial<ExtractionDeps> = {}, log: string[] = []): ExtractionDeps {
  return {
    checkAgentAuth: vi.fn().mockResolvedValue('authenticated'),
    fetchEntities: vi.fn(async () => {
      log.push('entities:start');
      log.push('entities:done');
      return '/proj/.contentful/.existing-entities.json';
    }),
    spawnExtract: vi.fn(async (_command: unknown, handlers: Handlers) => {
      log.push('extract:start');
      handlers.onStderrLine('progress=scan:3');
      handlers.onStderrLine('progress=scan-done:3');
      handlers.onStderrLine('progress=composition:agent:claude');
      handlers.onStdoutLine('session=sess-1');
      log.push('extract:session');
      handlers.onStderrLine('progress=composition:done');
      log.push('extract:exit');
      return { exitCode: 0, stdout: 'session=sess-1\n', stderr: 'Extracted 3 components\n' };
    }) as ExtractionDeps['spawnExtract'],
    runTokenGeneration: vi.fn(async () => {
      log.push('tokens:start');
      return {
        ok: true as const,
        tokensPath: '/proj/.contentful/tokens.json',
        tokenSessionId: 'tok-1',
        tokenCount: 12,
      };
    }),
    runSelection: vi.fn(async () => {
      log.push('selection');
    }),
    ...overrides,
  };
}

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
      spawnExtract: vi.fn(async (_c: unknown, handlers: Handlers) => {
        handlers.onStderrLine('progress=composition:cache-hit');
        handlers.onStdoutLine('session=sess-1');
        return { exitCode: 0, stdout: 'session=sess-1\n', stderr: 'Extracted 1 component\n' };
      }) as ExtractionDeps['spawnExtract'],
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
  it('starts selection as soon as the session is printed, while the extract command is still running', async () => {
    // The extract mock stays "running" until selection has started. If selection only began after the command
    // exited, this would never be released and the run would hang.
    let selectionStarted: () => void = () => {};
    const selectionRan = new Promise<void>((resolve) => (selectionStarted = resolve));
    const log: string[] = [];
    const deps = makeDeps(
      {
        runSelection: vi.fn(async () => {
          log.push('selection');
          selectionStarted();
        }),
        spawnExtract: vi.fn(async (_command: unknown, handlers: Handlers) => {
          handlers.onStdoutLine('session=sess-1');
          await selectionRan;
          log.push('extract:exit');
          return { exitCode: 0, stdout: 'session=sess-1\n', stderr: 'Extracted 3 components\n' };
        }) as ExtractionDeps['spawnExtract'],
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

  it('still starts selection when the session only shows up in the final output', async () => {
    const deps = makeDeps({
      spawnExtract: vi.fn(async () => ({ exitCode: 0, stdout: 'session=late\n', stderr: 'Extracted 1 component\n' })),
    });
    const result = await runExtraction(input(), () => {}, deps);
    expect(deps.runSelection).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'late' }));
    expect(result.ok && result.extraction.sessionId).toBe('late');
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

    expect(deps.runTokenGeneration).not.toHaveBeenCalled();
    expect(result.ok && result.extraction.tokenSessionId).toBeNull();
  });

  it('does not generate tokens when no raw tokens file was given', async () => {
    const deps = makeDeps();
    await runExtraction(input({ rawTokensPath: '' }), () => {}, deps);
    expect(deps.runTokenGeneration).not.toHaveBeenCalled();
  });

  it('forces the token cache off for a regenerate, and only for a regenerate', async () => {
    const regenerate = makeDeps();
    await runExtraction(input({ tokenStrategy: 'regenerate' }), () => {}, regenerate);
    expect(regenerate.runTokenGeneration).toHaveBeenCalledWith(expect.objectContaining({ noCache: true }));

    const normal = makeDeps();
    await runExtraction(input({ tokenStrategy: 'generate' }), () => {}, normal);
    expect(normal.runTokenGeneration).toHaveBeenCalledWith(expect.objectContaining({ noCache: false }));
  });

  it('passes the cache setting to extraction and selection', async () => {
    const deps = makeDeps();
    await runExtraction(input({ noCache: true, promptOverrides: ['x=y'] }), () => {}, deps);
    expect(deps.spawnExtract).toHaveBeenCalledWith(
      expect.objectContaining({ noCache: true, promptOverrides: ['x=y'] }),
      expect.anything(),
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
      expect(deps.spawnExtract).not.toHaveBeenCalled();
      expect(deps.fetchEntities).not.toHaveBeenCalled();
    },
  );

  it('reports the extract error output when the command fails', async () => {
    const deps = makeDeps({
      spawnExtract: vi.fn(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: source directory does not exist\n',
      })),
    });
    expect(await runExtraction(input(), () => {}, deps)).toEqual({
      ok: false,
      step: 'analyze extract',
      message: 'Error: source directory does not exist',
    });
  });

  it('says "Unknown error" when the command fails without saying why', async () => {
    const deps = makeDeps({ spawnExtract: vi.fn(async () => ({ exitCode: 2, stdout: '', stderr: '' })) });
    expect(await runExtraction(input(), () => {}, deps)).toMatchObject({ ok: false, message: 'Unknown error' });
  });

  it('reports no components found when the count is zero', async () => {
    const deps = makeDeps({
      spawnExtract: vi.fn(async () => ({ exitCode: 0, stdout: 'session=s\n', stderr: 'Extracted 0 components\n' })),
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
      runTokenGeneration: vi.fn(async () => ({
        ok: false as const,
        step: 'print tokens' as const,
        message: 'disk full',
      })),
    });
    expect(await runExtraction(input(), () => {}, deps)).toEqual({
      ok: false,
      step: 'print tokens',
      message: 'disk full',
    });
  });

  it('treats a failed entities fetch as unavailable and carries on', async () => {
    const deps = makeDeps({ fetchEntities: vi.fn().mockResolvedValue(null) });
    const result = await runExtraction(input(), () => {}, deps);
    expect(result.ok && result.extraction.existingEntitiesStatus).toBe('failed');
    expect(result.ok && result.extraction.existingEntitiesPath).toBeNull();
  });

  it('fails clearly if the extract command never printed a session', async () => {
    const deps = makeDeps({
      spawnExtract: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: 'Extracted 2 components\n' })),
    });
    expect(await runExtraction(input(), () => {}, deps)).toMatchObject({ ok: false, step: 'analyze extract' });
  });

  describe('when more than one thing fails, the user sees the first of: extract, no components, selection, tokens', () => {
    const everythingFails = (overrides: Partial<ExtractionDeps>): ExtractionDeps =>
      makeDeps({
        runSelection: vi.fn().mockRejectedValue(new Error('selection broke')),
        runTokenGeneration: vi.fn(async () => ({
          ok: false as const,
          step: 'generate tokens' as const,
          message: 'tokens broke',
        })),
        ...overrides,
      });

    it('extract beats everything', async () => {
      const deps = everythingFails({
        spawnExtract: vi.fn(async () => ({ exitCode: 1, stdout: 'session=s\n', stderr: 'extract broke' })),
      });
      expect(await runExtraction(input(), () => {}, deps)).toMatchObject({
        step: 'analyze extract',
        message: 'extract broke',
      });
    });

    it('no components beats selection and tokens', async () => {
      const deps = everythingFails({
        spawnExtract: vi.fn(async () => ({ exitCode: 0, stdout: 'session=s\n', stderr: 'Extracted 0 components' })),
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
