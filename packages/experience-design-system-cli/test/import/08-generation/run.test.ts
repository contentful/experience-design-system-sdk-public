import { progressRows } from '../../../src/tui/import/steps/08-generation/logic.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ImportGenerationProgress,
  ImportGenerationResult,
} from '@contentful/experience-design-system-backend-pipeline';
import { runGeneration } from '../../../src/tui/import/steps/08-generation/run.js';
import type { GenerationInput, GenerationProgress } from '../../../src/tui/import/steps/08-generation/types.js';

const backend = vi.hoisted(() => ({ runImportGeneration: vi.fn() }));
vi.mock('@contentful/experience-design-system-backend-pipeline', async (load) => ({
  ...(await load<typeof import('@contentful/experience-design-system-backend-pipeline')>()),
  ...backend,
}));

const input: GenerationInput = {
  sessionId: 'extract-1',
  decisions: { accepted: ['Button', 'Card'], rejected: [] },
  cachedNames: Promise.resolve([]),
  tokensPath: '',
  tokenSessionId: null,
  existingEntitiesPath: null,
  agent: 'claude',
  promptOverrides: [],
  noCache: true,
  hasTokens: false,
};
const success: ImportGenerationResult = {
  ok: true,
  generation: {
    route: 'review',
    sessionId: 'extract-1',
    acceptedCount: 2,
    generatedCount: 1,
    mapTokensEligible: false,
    generationIssues: [{ componentName: 'Button', error: 'Unknown slot' }],
  },
};

describe('generation UI adapter', () => {
  beforeEach(() => {
    backend.runImportGeneration.mockReset();
  });

  it('passes inputs and preserves the backend continuation outcome and warnings', async () => {
    backend.runImportGeneration.mockResolvedValue(success);
    expect(await runGeneration(input, () => {})).toBe(success);
    expect(backend.runImportGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'extract-1',
        decisions: input.decisions,
      }),
      expect.any(Function),
    );
  });

  it('preserves cache fallback diagnostics across later progress events', async () => {
    backend.runImportGeneration.mockImplementation(
      async (_input, report: (event: ImportGenerationProgress) => void) => {
        report({ kind: 'cache-check', state: 'failed' });
        report({
          kind: 'components',
          event: { kind: 'component:cached', index: 0, total: 2, name: 'Button', pinned: false },
        });
        report({ kind: 'map-tokens', eligible: false, state: 'complete' });
        return success;
      },
    );
    const progress: GenerationProgress[] = [];
    await runGeneration(input, (event) => progress.push(event));
    expect(progress).toHaveLength(3);
    expect(progress.every((event) => event.cacheRestoreFailed)).toBe(true);
    expect(progress[2]?.mapTokens).toBe('complete');
  });

  it('preserves operational errors from the backend', async () => {
    const error = { ok: false, step: 'generate components', message: 'Agent timed out' };
    backend.runImportGeneration.mockResolvedValue(error);
    expect(await runGeneration(input, () => {})).toBe(error);
  });

  it.each(['not-found', 'unauthenticated'] as const)(
    'renders instructions for %s authentication',
    async (authStatus) => {
      backend.runImportGeneration.mockResolvedValue({ ok: false, step: 'claude auth check', message: '', authStatus });
      const result = await runGeneration(input, () => {});
      expect(result).toMatchObject({ ok: false, step: 'claude auth check' });
      expect(!result.ok && result.message).toContain(
        authStatus === 'not-found' ? 'was not found on your PATH' : 'is not authenticated',
      );
    },
  );

  it('renders progress from backend events without counting rejected attempts as completed', async () => {
    backend.runImportGeneration.mockImplementation(
      async (_input, report: (event: ImportGenerationProgress) => void) => {
        report({
          kind: 'components',
          event: {
            kind: 'component:preflight-failed',
            index: 0,
            total: 2,
            name: 'Button',
            attempt: 1,
            maxAttempts: 2,
            error: 'Unknown slot',
          },
        });
        report({
          kind: 'components',
          event: { kind: 'component:failed', index: 0, total: 2, name: 'Button', error: 'Unknown slot' },
        });
        report({
          kind: 'components',
          event: {
            kind: 'component:completed',
            index: 1,
            total: 2,
            name: 'Card',
            classified: 1,
            excluded: 0,
            slots: 0,
            warnings: [],
          },
        });
        report({ kind: 'map-tokens', eligible: true, state: 'running' });
        report({ kind: 'map-tokens', eligible: true, state: 'complete' });
        return success;
      },
    );
    const seen: GenerationProgress[] = [];
    await runGeneration(input, (progress) => seen.push(progress));
    expect(seen[0]?.components).toEqual({
      done: 0,
      total: 2,
      current: 'Button: generation preflight failed, regenerating',
      failed: 0,
    });
    expect(seen[2]?.components).toEqual({ done: 2, total: 2, current: 'Card', failed: 1 });
    expect(seen.map((progress) => progress.mapTokens)).toContain('running');
    expect(seen.at(-1)).toMatchObject({ mapTokens: 'complete', mapTokensEligible: true });
  });
  it('counts an exhausted proposal as generated and renders a review warning rather than a failed stage', async () => {
    backend.runImportGeneration.mockImplementation(
      async (_input, report: (event: ImportGenerationProgress) => void) => {
        report({
          kind: 'components',
          event: { kind: 'component:review-required', index: 0, total: 1, name: 'Card', error: 'Empty enum' },
        });
        return success;
      },
    );
    const seen: GenerationProgress[] = [];
    await runGeneration(input, (progress) => seen.push(progress));
    expect(seen[0]?.components).toMatchObject({ done: 1, failed: 0, needsReview: 1 });
    expect(progressRows(seen[0]!, 'claude')[0]).toMatchObject({
      text: 'Generated 1 component, 1 needs review',
      complete: true,
      state: 'warning',
    });
  });
});
