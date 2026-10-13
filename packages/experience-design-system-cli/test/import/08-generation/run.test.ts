import { describe, expect, it, vi } from 'vitest';
import type { AgentAuthStatus } from '@contentful/experience-design-system-generation';
import { runGeneration, type GenerationDeps } from '../../../src/tui/import/steps/08-generation/run.js';
import type { GenerationInput, GenerationProgress } from '../../../src/tui/import/steps/08-generation/types.js';

const input = (overrides: Partial<GenerationInput> = {}): GenerationInput => ({
  sessionId: 'extract-1',
  decisions: { accepted: ['Button', 'Card'], rejected: ['Helper'] },
  cachedNames: Promise.resolve([]),
  tokensPath: '/p/.contentful/tokens.json',
  tokenSessionId: 'tok-1',
  existingEntitiesPath: null,
  agent: 'claude',
  promptOverrides: [],
  noCache: false,
  hasTokens: true,
  ...overrides,
});

const generated = { exitCode: 0, stdout: 'session=gen-1\n', stderr: 'Generated 2 components\n' };

// every dependency records when it ran, so the order of the stage can be checked, not just what each one did
function fakes(overrides: Partial<GenerationDeps> = {}) {
  const calls: string[] = [];
  const deps: GenerationDeps = {
    checkAgentAuth: vi.fn(async (): Promise<AgentAuthStatus> => {
      calls.push('auth');
      return 'ok';
    }),
    saveDecisions: vi.fn(async () => {
      calls.push('save');
    }),
    checkCache: vi.fn(async () => {
      calls.push('check-cache');
      return [];
    }),
    spawnGenerate: vi.fn(async () => {
      calls.push('generate');
      return generated;
    }),
    prepareMapTokens: vi.fn(async () => {
      calls.push('prepare-map');
      return { eligible: true, mappablePropCount: 2, rawTokenCount: 3 };
    }),
    runMapTokens: vi.fn(async () => {
      calls.push('map');
      return { exitCode: 0, stdout: '', stderr: '' };
    }),
    ...overrides,
  };
  return { deps, calls };
}

describe('runGeneration', () => {
  describe('a normal run, nothing cached', () => {
    it('saves, looks at the cache again, generates, then maps tokens, in that order', async () => {
      const { deps, calls } = fakes();
      const result = await runGeneration(input(), () => {}, deps);
      expect(calls).toEqual(['save', 'auth', 'check-cache', 'generate', 'prepare-map', 'map']);
      expect(result).toEqual({
        ok: true,
        generation: {
          route: 'review',
          sessionId: 'gen-1',
          acceptedCount: 2,
          generatedCount: 2,
          mapTokensEligible: true,
        },
      });
    });

    it('saves the decisions before anything else touches the database', async () => {
      const { deps, calls } = fakes();
      await runGeneration(input(), () => {}, deps);
      expect(calls[0]).toBe('save');
    });

    it('passes the decisions it was given to the save', async () => {
      const { deps } = fakes();
      await runGeneration(input(), () => {}, deps);
      expect(deps.saveDecisions).toHaveBeenCalledWith({
        sessionId: 'extract-1',
        decisions: { accepted: ['Button', 'Card'], rejected: ['Helper'] },
      });
    });

    it('uses the session the command reports, and the count it reports', async () => {
      const { deps } = fakes({
        spawnGenerate: vi.fn(async () => ({
          exitCode: 0,
          stdout: 'session=gen-9\n',
          stderr: 'Generated 1 component\n',
        })),
      });
      const result = await runGeneration(input(), () => {}, deps);
      expect(result).toMatchObject({
        ok: true,
        generation: { sessionId: 'gen-9', generatedCount: 1, acceptedCount: 2 },
      });
    });

    it('falls back to the extraction session when the command prints none', async () => {
      const { deps } = fakes({ spawnGenerate: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })) });
      const result = await runGeneration(input(), () => {}, deps);
      expect(result).toMatchObject({ ok: true, generation: { sessionId: 'extract-1' } });
    });

    it('maps tokens on the generated session, not the extraction one', async () => {
      const { deps } = fakes();
      await runGeneration(input(), () => {}, deps);
      expect(deps.prepareMapTokens).toHaveBeenCalledWith(expect.anything(), 'gen-1');
      expect(deps.runMapTokens).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'gen-1' }));
    });
  });

  describe('waiting for the cache check', () => {
    it('does not save the decisions until the check has finished restoring the cache', async () => {
      let finishCheck!: (names: string[]) => void;
      const cachedNames = new Promise<string[]>((resolve) => (finishCheck = resolve));
      const { deps, calls } = fakes();
      const run = runGeneration(input({ cachedNames }), () => {}, deps);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toEqual([]);

      finishCheck([]);
      await run;
      expect(calls[0]).toBe('save');
    });

    it('treats a check that failed as nothing cached, and goes on', async () => {
      const { deps, calls } = fakes();
      const result = await runGeneration(input({ cachedNames: Promise.reject(new Error('boom')) }), () => {}, deps);
      expect(result).toMatchObject({ ok: true });
      expect(calls).toContain('generate');
    });
  });

  describe('the cache', () => {
    it('takes everything from the cache when every accepted component is in it, without generating', async () => {
      const { deps, calls } = fakes();
      const result = await runGeneration(input({ cachedNames: Promise.resolve(['Button', 'Card']) }), () => {}, deps);
      expect(calls).toEqual(['save', 'auth', 'prepare-map', 'map']);
      expect(result).toEqual({
        ok: true,
        generation: {
          route: 'review',
          sessionId: 'extract-1',
          acceptedCount: 2,
          generatedCount: 2,
          mapTokensEligible: true,
        },
      });
    });

    it('does not look at the cache again after a full hit', async () => {
      const { deps } = fakes();
      await runGeneration(input({ cachedNames: Promise.resolve(['Button', 'Card']) }), () => {}, deps);
      expect(deps.checkCache).not.toHaveBeenCalled();
    });

    it('looks again after saving when the earlier answer was only partial, and takes a hit it finds', async () => {
      const { deps, calls } = fakes({ checkCache: vi.fn(async () => ['Button', 'Card']) });
      await runGeneration(input({ cachedNames: Promise.resolve(['Button']) }), () => {}, deps);
      expect(calls).toEqual(['save', 'auth', 'prepare-map', 'map']);
      expect(deps.spawnGenerate).not.toHaveBeenCalled();
    });

    it('generates only what is missing, passing the components the cache does hold', async () => {
      const { deps } = fakes({ checkCache: vi.fn(async () => ['Button']) });
      await runGeneration(input(), () => {}, deps);
      expect(deps.spawnGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ cachedComponents: ['Button'] }),
        expect.anything(),
      );
    });

    it('only passes cached components that were accepted', async () => {
      const { deps } = fakes({ checkCache: vi.fn(async () => ['Button', 'Helper']) });
      await runGeneration(input(), () => {}, deps);
      expect(deps.spawnGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ cachedComponents: ['Button'] }),
        expect.anything(),
      );
    });

    it('never uses the cache with it turned off, and does not even look', async () => {
      const { deps, calls } = fakes();
      await runGeneration(input({ noCache: true, cachedNames: Promise.resolve(['Button', 'Card']) }), () => {}, deps);
      expect(calls).toEqual(['save', 'auth', 'generate', 'prepare-map', 'map']);
      expect(deps.checkCache).not.toHaveBeenCalled();
    });

    it('does not look at the cache for a run where nothing was accepted', async () => {
      const { deps } = fakes();
      await runGeneration(input({ decisions: { accepted: [], rejected: ['Button', 'Card'] } }), () => {}, deps);
      expect(deps.checkCache).not.toHaveBeenCalled();
    });
  });

  describe('the agent check', () => {
    it('happens after the decisions are saved and before anything uses the agent', async () => {
      const { deps, calls } = fakes();
      await runGeneration(input(), () => {}, deps);
      expect(calls.indexOf('save')).toBeLessThan(calls.indexOf('auth'));
      expect(calls.indexOf('auth')).toBeLessThan(calls.indexOf('generate'));
    });

    it('checks the agent that was chosen', async () => {
      const { deps } = fakes();
      await runGeneration(input({ agent: 'codex' }), () => {}, deps);
      expect(deps.checkAgentAuth).toHaveBeenCalledWith('codex');
    });

    it.each([
      ['not-found', /was not found on your PATH/],
      ['unauthenticated', /is not authenticated/],
    ] as const)('stops with a clear message when the agent is %s', async (status, message) => {
      const { deps, calls } = fakes({ checkAgentAuth: vi.fn(async (): Promise<AgentAuthStatus> => status) });
      const result = await runGeneration(input(), () => {}, deps);
      expect(result).toMatchObject({ ok: false, step: 'claude auth check' });
      expect(!result.ok && result.message).toMatch(message);
      expect(calls).toEqual(['save']);
    });

    it('still saves the decisions when the agent check fails, since that is what the wizard did', async () => {
      const { deps } = fakes({ checkAgentAuth: vi.fn(async (): Promise<AgentAuthStatus> => 'unauthenticated') });
      await runGeneration(input(), () => {}, deps);
      expect(deps.saveDecisions).toHaveBeenCalledTimes(1);
    });

    it('is not needed when nothing was accepted, since nothing uses the agent', async () => {
      const { deps } = fakes();
      await runGeneration(input({ decisions: { accepted: [], rejected: ['Button'] } }), () => {}, deps);
      expect(deps.checkAgentAuth).not.toHaveBeenCalled();
    });

    it('is checked even when everything comes from the cache, since mapping tokens still uses the agent', async () => {
      const { deps } = fakes();
      await runGeneration(input({ cachedNames: Promise.resolve(['Button', 'Card']) }), () => {}, deps);
      expect(deps.checkAgentAuth).toHaveBeenCalledTimes(1);
    });
  });

  describe('nothing accepted', () => {
    const nothing = (): GenerationInput => input({ decisions: { accepted: [], rejected: ['Button', 'Card'] } });

    it('saves the decisions and stops, going straight to the push flow', async () => {
      const { deps, calls } = fakes();
      const result = await runGeneration(nothing(), () => {}, deps);
      expect(calls).toEqual(['save']);
      expect(result).toEqual({ ok: true, generation: { route: 'push', acceptedCount: 0 } });
    });

    it('does not look at the cache, generate or map tokens', async () => {
      const { deps } = fakes();
      await runGeneration(nothing(), () => {}, deps);
      expect(deps.checkCache).not.toHaveBeenCalled();
      expect(deps.spawnGenerate).not.toHaveBeenCalled();
      expect(deps.prepareMapTokens).not.toHaveBeenCalled();
      expect(deps.runMapTokens).not.toHaveBeenCalled();
    });

    it('still saves what was rejected, so the snapshot and the rows are right', async () => {
      const { deps } = fakes();
      await runGeneration(nothing(), () => {}, deps);
      expect(deps.saveDecisions).toHaveBeenCalledWith({
        sessionId: 'extract-1',
        decisions: { accepted: [], rejected: ['Button', 'Card'] },
      });
    });

    it('reports a failed save instead of going on', async () => {
      const { deps } = fakes({
        saveDecisions: vi.fn(async () => {
          throw new Error('database is locked');
        }),
      });
      expect(await runGeneration(nothing(), () => {}, deps)).toEqual({
        ok: false,
        step: 'save decisions',
        message: 'database is locked',
      });
    });
  });

  describe('token mapping', () => {
    it('is skipped when there is nothing to map, and the stage still succeeds', async () => {
      const { deps, calls } = fakes({
        prepareMapTokens: vi.fn(async () => ({ eligible: false, mappablePropCount: 0, rawTokenCount: 3 })),
      });
      const result = await runGeneration(input(), () => {}, deps);
      expect(calls).not.toContain('map');
      expect(result).toMatchObject({ ok: true, generation: { mapTokensEligible: false } });
    });

    it('reports a failed mapping as an error, keeping what generation did', async () => {
      const { deps } = fakes({
        runMapTokens: vi.fn(async () => ({ exitCode: 2, stdout: '', stderr: 'agent crashed\n' })),
      });
      const result = await runGeneration(input(), () => {}, deps);
      expect(result).toEqual({ ok: false, step: 'map tokens', message: 'agent crashed' });
      expect(deps.spawnGenerate).toHaveBeenCalledTimes(1);
    });

    it('does not run the mapping command again after it fails', async () => {
      const { deps } = fakes({ runMapTokens: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'x' })) });
      await runGeneration(input(), () => {}, deps);
      expect(deps.runMapTokens).toHaveBeenCalledTimes(1);
    });

    it('reports a problem preparing the tokens as a map tokens error, with its message', async () => {
      const { deps } = fakes({
        prepareMapTokens: vi.fn(async () => {
          throw new Error('file not found: /p/tokens.json (from tokens)');
        }),
      });
      expect(await runGeneration(input(), () => {}, deps)).toEqual({
        ok: false,
        step: 'map tokens',
        message: 'file not found: /p/tokens.json (from tokens)',
      });
    });
  });

  describe('failures', () => {
    it('stops at a failed save without generating or mapping', async () => {
      const { deps, calls } = fakes({
        saveDecisions: vi.fn(async () => {
          throw new Error('database is locked');
        }),
      });
      expect(await runGeneration(input(), () => {}, deps)).toEqual({
        ok: false,
        step: 'save decisions',
        message: 'database is locked',
      });
      expect(calls).toEqual([]);
    });

    it('reports a failed generation with the command error, and does not map tokens', async () => {
      const { deps } = fakes({
        spawnGenerate: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: ' agent timed out \n' })),
      });
      expect(await runGeneration(input(), () => {}, deps)).toEqual({
        ok: false,
        step: 'generate components',
        message: 'agent timed out',
      });
      expect(deps.prepareMapTokens).not.toHaveBeenCalled();
    });

    it('says Unknown error when the command failed without saying why', async () => {
      const { deps } = fakes({ spawnGenerate: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: '' })) });
      expect(await runGeneration(input(), () => {}, deps)).toMatchObject({ message: 'Unknown error' });
    });
  });

  describe('progress', () => {
    it('shows each component as the command reports it', async () => {
      const seen: GenerationProgress[] = [];
      const { deps } = fakes({
        spawnGenerate: vi.fn(async (_command, handlers) => {
          handlers.onStderr('progress=generate:1/2:Button\n');
          handlers.onStderr('progress=generate:2/2:Card\n');
          return generated;
        }),
      });
      await runGeneration(input(), (progress) => seen.push(progress), deps);
      expect(seen.map((p) => p.components)).toContainEqual({ done: 1, total: 2, current: 'Button' });
      expect(seen.map((p) => p.components)).toContainEqual({ done: 2, total: 2, current: 'Card' });
    });

    it('does not report progress twice for a chunk that changes nothing', async () => {
      const seen: GenerationProgress[] = [];
      const { deps } = fakes({
        spawnGenerate: vi.fn(async (_command, handlers) => {
          handlers.onStderr('some unrelated stderr\n');
          return generated;
        }),
      });
      await runGeneration(input(), (progress) => seen.push(progress), deps);
      expect(seen.every((p) => p.components === null)).toBe(true);
    });

    it('moves token mapping from running to complete', async () => {
      const seen: GenerationProgress[] = [];
      const { deps } = fakes();
      await runGeneration(input(), (progress) => seen.push(progress), deps);
      expect(seen.map((p) => p.mapTokens)).toContain('running');
      expect(seen[seen.length - 1]?.mapTokens).toBe('complete');
    });
  });

  it('passes the agent, model, prompts, custom generate prompt and entities through to the commands', async () => {
    const { deps } = fakes();
    await runGeneration(
      input({
        agentModel: 'opus',
        promptOverrides: ['components=/p/a.md'],
        generatePromptPath: '/p/gen.md',
        existingEntitiesPath: '/p/.existing.json',
      }),
      () => {},
      deps,
    );
    expect(deps.spawnGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'claude',
        agentModel: 'opus',
        promptOverrides: ['components=/p/a.md'],
        generatePromptPath: '/p/gen.md',
        existingEntitiesPath: '/p/.existing.json',
      }),
      expect.anything(),
    );
    expect(deps.runMapTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        agentModel: 'opus',
        promptOverrides: ['components=/p/a.md'],
        existingEntitiesPath: '/p/.existing.json',
      }),
    );
  });
});
