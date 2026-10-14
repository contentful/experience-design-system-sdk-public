import { describe, expect, it, vi } from 'vitest';
import type {
  AgentAuthStatus,
  RunGenerateComponentsSessionResponse,
} from '@contentful/experience-design-system-backend-pipeline';
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

const generatedResponse = (
  overrides: Partial<RunGenerateComponentsSessionResponse> = {},
): RunGenerateComponentsSessionResponse => ({
  sessionId: 'extract-1',
  results: [
    {
      componentName: 'Button',
      classified: 1,
      excluded: 0,
      slots: 0,
      warnings: [],
      failed: false,
      cached: false,
      renamedSlotsCount: 0,
    },
    {
      componentName: 'Card',
      classified: 1,
      excluded: 0,
      slots: 0,
      warnings: [],
      failed: false,
      cached: false,
      renamedSlotsCount: 0,
    },
  ],
  allOk: true,
  renamedSlotsCount: 0,
  duplicateNames: [],
  droppedAllowedComponents: [],
  emptySession: false,
  ...overrides,
});

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
    runGenerate: vi.fn(async () => {
      calls.push('generate');
      return generatedResponse();
    }) as GenerationDeps['runGenerate'],
    prepareMapTokens: vi.fn(async () => {
      calls.push('prepare-map');
      return { eligible: true, mappablePropCount: 2, rawTokenCount: 3 };
    }),
    runMapTokens: vi.fn(async () => {
      calls.push('map');
      return {
        type: 'applied',
        sessionId: 'extract-1',
        applied: 2,
        warnings: [],
        stepId: 1,
        diagnostics: [],
      } as never;
    }) as GenerationDeps['runMapTokens'],
    ...overrides,
  };
  return { deps, calls };
}

describe('runGeneration', () => {
  describe('a normal run', () => {
    it('saves, auths, generates, prepares then maps tokens, in that order', async () => {
      const { deps, calls } = fakes();
      const result = await runGeneration(input(), () => {}, deps);
      expect(calls).toEqual(['save', 'auth', 'generate', 'prepare-map', 'map']);
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

    it('passes the decisions to the save', async () => {
      const { deps } = fakes();
      await runGeneration(input(), () => {}, deps);
      expect(deps.saveDecisions).toHaveBeenCalledWith({
        sessionId: 'extract-1',
        decisions: { accepted: ['Button', 'Card'], rejected: ['Helper'] },
      });
    });

    it('forwards the handed-over cache names to the orchestrator', async () => {
      const { deps } = fakes();
      await runGeneration(input({ cachedNames: Promise.resolve(['Button']) }), () => {}, deps);
      expect(deps.runGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ precomputedCachedNames: new Set(['Button']) }),
      );
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

    it('still saves the decisions when the agent check fails', async () => {
      const { deps } = fakes({ checkAgentAuth: vi.fn(async (): Promise<AgentAuthStatus> => 'unauthenticated') });
      await runGeneration(input(), () => {}, deps);
      expect(deps.saveDecisions).toHaveBeenCalledTimes(1);
    });

    it('is not needed when nothing was accepted', async () => {
      const { deps } = fakes();
      await runGeneration(input({ decisions: { accepted: [], rejected: ['Button'] } }), () => {}, deps);
      expect(deps.checkAgentAuth).not.toHaveBeenCalled();
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

    it('does not generate or map tokens', async () => {
      const { deps } = fakes();
      await runGeneration(nothing(), () => {}, deps);
      expect(deps.runGenerate).not.toHaveBeenCalled();
      expect(deps.prepareMapTokens).not.toHaveBeenCalled();
      expect(deps.runMapTokens).not.toHaveBeenCalled();
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
        runMapTokens: vi.fn(async () => {
          throw new Error('agent crashed');
        }) as GenerationDeps['runMapTokens'],
      });
      const result = await runGeneration(input(), () => {}, deps);
      expect(result).toEqual({ ok: false, step: 'map tokens', message: 'agent crashed' });
      expect(deps.runGenerate).toHaveBeenCalledTimes(1);
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

    it('reports a failed generation with the orchestrator error, and does not map tokens', async () => {
      const { deps } = fakes({
        runGenerate: vi.fn(async () =>
          generatedResponse({
            allOk: false,
            results: [
              {
                componentName: 'Button',
                classified: 0,
                excluded: 0,
                slots: 0,
                warnings: [],
                failed: true,
                error: 'agent timed out',
                cached: false,
                renamedSlotsCount: 0,
              },
            ],
          }),
        ) as GenerationDeps['runGenerate'],
      });
      expect(await runGeneration(input(), () => {}, deps)).toEqual({
        ok: false,
        step: 'generate components',
        message: 'agent timed out',
      });
      expect(deps.prepareMapTokens).not.toHaveBeenCalled();
    });

    it('reports a thrown error from the orchestrator', async () => {
      const { deps } = fakes({
        runGenerate: vi.fn(async () => {
          throw new Error('db locked');
        }) as GenerationDeps['runGenerate'],
      });
      expect(await runGeneration(input(), () => {}, deps)).toEqual({
        ok: false,
        step: 'generate components',
        message: 'db locked',
      });
    });
  });

  describe('progress', () => {
    it('reports completed components to the screen', async () => {
      const seen: GenerationProgress[] = [];
      const { deps } = fakes({
        runGenerate: vi.fn(async (req) => {
          req.onProgress?.({
            kind: 'component:started',
            index: 0,
            total: 2,
            name: 'Button',
            attempt: 1,
            maxAttempts: 2,
          });
          req.onProgress?.({
            kind: 'component:completed',
            index: 0,
            total: 2,
            name: 'Button',
            classified: 1,
            excluded: 0,
            slots: 0,
            warnings: [],
          });
          req.onProgress?.({ kind: 'component:started', index: 1, total: 2, name: 'Card', attempt: 1, maxAttempts: 2 });
          req.onProgress?.({
            kind: 'component:completed',
            index: 1,
            total: 2,
            name: 'Card',
            classified: 1,
            excluded: 0,
            slots: 0,
            warnings: [],
          });
          return generatedResponse();
        }) as GenerationDeps['runGenerate'],
      });
      await runGeneration(input(), (progress) => seen.push(progress), deps);
      expect(seen.map((p) => p.components)).toContainEqual({ done: 1, total: 2, current: 'Button' });
      expect(seen.map((p) => p.components)).toContainEqual({ done: 2, total: 2, current: 'Card' });
    });

    it('moves token mapping from running to complete', async () => {
      const seen: GenerationProgress[] = [];
      const { deps } = fakes();
      await runGeneration(input(), (progress) => seen.push(progress), deps);
      expect(seen.map((p) => p.mapTokens)).toContain('running');
      expect(seen[seen.length - 1]?.mapTokens).toBe('complete');
    });
  });
});
