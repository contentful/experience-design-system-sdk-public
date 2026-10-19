import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportHandoff } from '@contentful/experience-design-system-types/handoff';

const steps = vi.hoisted(() => ({
  runPreview: vi.fn(),
  runPush: vi.fn(),
  runPrintFiles: vi.fn(),
  recordRun: vi.fn(),
}));
vi.mock('../../../src/tui/import/steps/10-flow/flow/preview.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runPreview: steps.runPreview,
}));
vi.mock('../../../src/tui/import/steps/10-flow/flow/push.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runPush: steps.runPush,
}));
vi.mock('../../../src/tui/import/steps/10-flow/flow/save.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runPrintFiles: steps.runPrintFiles,
  recordRun: steps.recordRun,
}));

import {
  createFlowController,
  type FlowDeps,
  type FlowStart,
} from '../../../src/tui/import/steps/10-flow/flow/controller.js';

const extraction = {
  sessionId: 'ext-1',
  outDir: '/p/.contentful',
  tokensPath: '/p/.contentful/tokens.json',
  tokenSessionId: 'tok-1',
  tokenCount: 7,
  existingEntitiesPath: null,
  existingEntitiesStatus: 'idle' as const,
  compositionPhase: 'done' as const,
};
const handoff = (generation: ImportHandoff['generation'], credentialsSkipped = false): ImportHandoff => ({
  credentialsSkipped,
  tokens: { strategy: 'generate' },
  extraction,
  generation,
});
const review = {
  route: 'review',
  sessionId: 'gen-1',
  acceptedCount: 5,
  generatedCount: 4,
  mapTokensEligible: true,
} as const;

const start = (overrides: Partial<FlowStart> = {}): FlowStart => ({
  handoff: handoff(review),
  agent: 'claude',
  projectPath: '/p',
  outDir: '/default/out',
  rawTokensPath: '/raw.json',
  credentials: { spaceId: 'sp', environmentId: 'env', cmaToken: 'secret-token', host: 'api.example.com' },
  ...overrides,
});

const entry = { $type: 'component', $properties: {} };
const cdf = { $schema: 'https://contentful.com/schemas/cdf', Button: entry } as never;

describe('the flow controller', () => {
  const log = vi.fn();
  const stderr = vi.fn();
  const mkdir = vi.fn();
  const detectSaveConflict = vi.fn();
  const buildTimestampedSubdir = vi.fn();
  const rejectComponentsByName = vi.fn();
  const loadAcceptedComponents = vi.fn();
  const beforeStepChange = vi.fn();

  const deps = (): FlowDeps => ({
    preview: {} as never,
    push: {} as never,
    save: {} as never,
    loadAcceptedComponents,
    mkdir,
    detectSaveConflict,
    buildTimestampedSubdir,
    rejectComponentsByName,
    log,
    stderr,
    beforeStepChange,
  });

  beforeEach(() => {
    for (const fake of [
      ...Object.values(steps),
      log,
      stderr,
      mkdir,
      detectSaveConflict,
      buildTimestampedSubdir,
      rejectComponentsByName,
      loadAcceptedComponents,
      beforeStepChange,
    ]) {
      fake.mockReset();
    }
    mkdir.mockResolvedValue(undefined);
    detectSaveConflict.mockResolvedValue(false);
    loadAcceptedComponents.mockReturnValue([]);
    steps.runPreview.mockResolvedValue({ step: 'preview-gate', cdf });
    steps.runPush.mockResolvedValue({ step: 'done' });
    steps.runPrintFiles.mockImplementation(async (_input, _deps, onPatch) => {
      onPatch({ step: 'printing' });
      return { ok: true, patch: {} };
    });
    steps.recordRun.mockResolvedValue('run-9');
  });

  describe('clearing the terminal between steps', () => {
    it('does so before listeners hear about the new step, so the clear cannot wipe what they draw', () => {
      const order: string[] = [];
      beforeStepChange.mockImplementation(() => order.push('clear'));
      const controller = createFlowController(start(), deps());
      controller.subscribe(() => order.push(`render:${controller.getState().step}`));
      order.length = 0;

      controller.finalize(4, 0, 0);

      expect(order).toEqual(['clear', 'render:path-prompt']);
    });

    it('clears for a change to a different step, including going back to one it was on before', () => {
      const controller = createFlowController(start(), deps());
      beforeStepChange.mockClear();

      controller.finalize(4, 0, 0); // final-review -> path-prompt
      controller.editDefinitions(); // path-prompt -> final-review

      expect(beforeStepChange).toHaveBeenCalledTimes(2);
    });

    it('clears once for each step change and not for an update that keeps the step', async () => {
      steps.runPush.mockImplementation(async (_i, _d, onPatch) => {
        onPatch({ step: 'pushing', pushProgress: { kind: 'queued', operationId: 'op-1' } });
        onPatch({ pushProgress: { kind: 'progress', processed: 1, total: 2, current: null } });
        return { step: 'done' };
      });
      const controller = createFlowController(start(), deps());
      controller.finalize(4, 0, 0);
      await controller.submitPath('/out');
      beforeStepChange.mockClear();

      controller.confirmPreview(false);
      await vi.waitFor(() => expect(controller.getState().step).toBe('done'));

      // pushing, then done; the progress update in between keeps the step and must not clear
      expect(beforeStepChange).toHaveBeenCalledTimes(2);
    });

    it('does not stop the import when the clear throws', () => {
      beforeStepChange.mockImplementation(() => {
        throw new Error('stdout closed');
      });
      const controller = createFlowController(start(), deps());

      controller.finalize(4, 0, 0);

      expect(controller.getState().step).toBe('path-prompt');
    });

    it('works without a clear being supplied', () => {
      const withoutClear = { ...deps() } as Partial<FlowDeps>;
      delete withoutClear.beforeStepChange;
      const controller = createFlowController(start(), withoutClear as FlowDeps);

      controller.finalize(4, 0, 0);

      expect(controller.getState().step).toBe('path-prompt');
    });
  });
});
