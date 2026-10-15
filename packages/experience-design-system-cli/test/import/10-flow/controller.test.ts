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
  initialFlowState,
  namesToSkip,
  sanitizeForLog,
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

  describe('where it begins', () => {
    it('opens the review when definitions were generated', () => {
      expect(createFlowController(start(), deps()).getState().step).toBe('final-review');
    });

    it('goes straight to choosing where to save when nothing was accepted, with no review', () => {
      const controller = createFlowController(start({ handoff: handoff({ route: 'push', acceptedCount: 0 }) }), deps());

      expect(controller.getState()).toMatchObject({ step: 'path-prompt', generatedAcceptedCount: 0 });
    });

    it('shows an error when the earlier stages handed over no generation', () => {
      const controller = createFlowController(start({ handoff: handoff(undefined) }), deps());

      expect(controller.getState()).toMatchObject({
        step: 'error',
        errorStep: 'start import',
        errorMessage: 'Internal error: the CLI did not hand over the generated definitions.',
      });
    });

    it('shows the same error when there is no extraction session', () => {
      const bare: ImportHandoff = { credentialsSkipped: false, tokens: { strategy: 'generate' }, generation: review };

      expect(createFlowController(start({ handoff: bare }), deps()).getState().step).toBe('error');
    });
  });

  describe('the state it starts with', () => {
    it('is built from what the earlier stages produced and the saved settings', () => {
      expect(initialFlowState(start())).toMatchObject({
        agent: 'claude',
        projectPath: '/p',
        outDir: '/p/.contentful',
        rawTokensPath: '/raw.json',
        tokensPath: '/p/.contentful/tokens.json',
        tokenSessionId: 'tok-1',
        tokenCount: 7,
        extractSessionId: 'ext-1',
        generateSessionId: 'gen-1',
        generatedCount: 4,
        generatedAcceptedCount: 0,
        mapTokensEligible: true,
        spaceId: 'sp',
        environmentId: 'env',
        cmaToken: 'secret-token',
        host: 'api.example.com',
        credentialsSkipped: false,
        lastRunId: null,
        finalReviewPassed: false,
      });
    });

    it('carries that credentials were skipped', () => {
      expect(initialFlowState(start({ handoff: handoff(review, true) })).credentialsSkipped).toBe(true);
    });

    it('has no generated session on the push route, and falls back to the default save folder with no extraction', () => {
      const pushOnly = initialFlowState(start({ handoff: handoff({ route: 'push', acceptedCount: 0 }) }));
      expect(pushOnly).toMatchObject({ generateSessionId: null, generatedCount: 0, mapTokensEligible: null });

      const bare: ImportHandoff = { credentialsSkipped: false, tokens: { strategy: 'generate' } };
      expect(initialFlowState(start({ handoff: bare }))).toMatchObject({
        outDir: '/default/out',
        tokensPath: '',
        tokenSessionId: null,
        tokenCount: 0,
        extractSessionId: null,
      });
    });
  });

  describe('finishing the review', () => {
    it('reports the counts on stderr, then asks where to save', () => {
      const controller = createFlowController(start(), deps());

      controller.finalize(3, 11, 2);

      expect(stderr).toHaveBeenCalledWith('Accepted: 3  Rejected: 11  Unresolved: 2\n');
      expect(controller.getState()).toMatchObject({
        step: 'path-prompt',
        finalReviewPassed: true,
        generatedAcceptedCount: 3,
      });
    });

    it('sends the user back to the review with the cycle report when the accepted components form a cycle', () => {
      const slot = (accepts: string[]) => ({
        $type: 'component',
        $properties: {},
        $slots: { children: { $allowedComponents: accepts } },
      });
      loadAcceptedComponents.mockReturnValue([
        { key: 'A', entry: slot(['B']) },
        { key: 'B', entry: slot(['A']) },
      ]);
      const controller = createFlowController(start(), deps());

      controller.finalize(2, 0, 0);

      const state = controller.getState();
      expect(state).toMatchObject({ step: 'error', errorStep: 'final review', errorAllowCredentialRetry: false });
      expect(state.errorMessage).toContain('A');
      expect(state.errorMessage).toContain('B');
      expect(state.finalReviewPassed).toBe(false);
    });

    it('reads the accepted components of the extraction session', () => {
      createFlowController(start(), deps()).finalize(1, 0, 0);

      expect(loadAcceptedComponents).toHaveBeenCalledWith('ext-1');
    });

    it('lets the finalize through when the cycle check itself fails, as the wizard did', () => {
      loadAcceptedComponents.mockImplementation(() => {
        throw new Error('db locked');
      });
      const controller = createFlowController(start(), deps());

      controller.finalize(1, 0, 0);

      expect(controller.getState().step).toBe('path-prompt');
    });
  });

  describe('saving', () => {
    const toPathPrompt = (overrides: Partial<FlowStart> = {}) => {
      const controller = createFlowController(start(overrides), deps());
      controller.finalize(4, 0, 0);
      return controller;
    };

    it('creates the folder it was given and writes there', async () => {
      const controller = toPathPrompt();

      await controller.submitPath('/chosen');

      expect(mkdir).toHaveBeenCalledWith('/chosen');
      expect(steps.runPrintFiles).toHaveBeenCalledWith(
        expect.objectContaining({ extractSessionId: 'ext-1', outDir: '/chosen' }),
        expect.anything(),
        expect.any(Function),
      );
      expect(controller.getState().outDir).toBe('/chosen');
    });

    it('writes into a new timestamped folder instead when the chosen one already has a save', async () => {
      detectSaveConflict.mockResolvedValue(true);
      buildTimestampedSubdir.mockReturnValue('/chosen/2026-10-13T16-00-00');
      const controller = toPathPrompt();

      await controller.submitPath('/chosen');

      expect(detectSaveConflict).toHaveBeenCalledWith('/chosen');
      expect(mkdir).toHaveBeenCalledWith('/chosen/2026-10-13T16-00-00');
      expect(steps.runPrintFiles).toHaveBeenCalledWith(
        expect.objectContaining({ outDir: '/chosen/2026-10-13T16-00-00' }),
        expect.anything(),
        expect.any(Function),
      );
      expect(controller.getState().outDir).toBe('/chosen/2026-10-13T16-00-00');
    });

    it('saves as part of a push, and passes on the tokens it has', async () => {
      await toPathPrompt().submitPath('/out');

      expect(steps.runPrintFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          skipGate: true,
          tokenSessionId: 'tok-1',
          tokensPath: '/p/.contentful/tokens.json',
        }),
        expect.anything(),
        expect.any(Function),
      );
    });

    it('leaves the token fields out when there are none', async () => {
      const noTokens: ImportHandoff = {
        ...handoff(review),
        extraction: { ...extraction, tokenSessionId: null, tokensPath: '' },
      };
      await toPathPrompt({ handoff: noTokens }).submitPath('/out');

      const input = steps.runPrintFiles.mock.calls[0][0];
      expect(input).not.toHaveProperty('tokenSessionId');
      expect(input).not.toHaveProperty('tokensPath');
    });

    it('writes an empty document, to delete everything, only when nothing was accepted', async () => {
      const none = createFlowController(start(), deps());
      none.finalize(0, 9, 0);
      await none.submitPath('/out');
      expect(steps.runPrintFiles.mock.calls[0][0]).toMatchObject({ allowEmpty: true });

      steps.runPrintFiles.mockClear();
      await toPathPrompt().submitPath('/out');
      expect(steps.runPrintFiles.mock.calls[0][0]).not.toHaveProperty('allowEmpty');
    });

    it('shows the write step the save reports, then what it ends on', async () => {
      steps.runPrintFiles.mockImplementation(async (_i, _d, onPatch) => {
        onPatch({ step: 'printing' });
        return { ok: true, patch: { componentsPath: '/out/components.json' } };
      });
      const controller = toPathPrompt();
      const seen: string[] = [];
      controller.subscribe(() => seen.push(controller.getState().step));

      await controller.submitPath('/out');

      expect(seen).toContain('printing');
      expect(controller.getState().componentsPath).toBe('/out/components.json');
    });

    it('records the run and remembers its id', async () => {
      const controller = toPathPrompt();

      await controller.submitPath('/out');

      expect(steps.recordRun).toHaveBeenCalledWith(
        expect.objectContaining({ savePath: '/out', state: expect.objectContaining({ generatedAcceptedCount: 4 }) }),
        expect.anything(),
      );
      expect(controller.getState().lastRunId).toBe('run-9');
    });

    it('keeps no run id when the run could not be recorded', async () => {
      steps.recordRun.mockResolvedValue(null);
      const controller = toPathPrompt();

      await controller.submitPath('/out');

      expect(controller.getState().lastRunId).toBeNull();
    });

    it('keeps the id of the earlier run when a later save cannot be recorded', async () => {
      const controller = toPathPrompt();
      await controller.submitPath('/out');
      expect(controller.getState().lastRunId).toBe('run-9');

      steps.recordRun.mockResolvedValue(null);
      controller.editDefinitions();
      controller.finalize(4, 0, 0);
      await controller.submitPath('/out-again');

      expect(controller.getState().lastRunId).toBe('run-9');
    });

    it('stops at the error, records nothing and does not preview, when the write failed', async () => {
      steps.runPrintFiles.mockResolvedValue({
        ok: false,
        patch: { step: 'error', errorStep: 'save CDF', errorMessage: 'EACCES' },
      });
      const controller = toPathPrompt();

      await controller.submitPath('/out');

      expect(controller.getState()).toMatchObject({ step: 'error', errorStep: 'save CDF', errorMessage: 'EACCES' });
      expect(steps.recordRun).not.toHaveBeenCalled();
      expect(steps.runPreview).not.toHaveBeenCalled();
    });
  });

  describe('previewing', () => {
    const saved = async (overrides: Partial<FlowStart> = {}, accepted = 4) => {
      const controller = createFlowController(start(overrides), deps());
      controller.finalize(accepted, 0, 0);
      await controller.submitPath('/out');
      return controller;
    };

    it('previews after saving, with the credentials and the session, and shows the gate', async () => {
      const controller = await saved();

      expect(steps.runPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          extractSessionId: 'ext-1',
          tokensPath: '/p/.contentful/tokens.json',
          spaceId: 'sp',
          environmentId: 'env',
          cmaToken: 'secret-token',
          host: 'api.example.com',
          deleteAll: false,
        }),
        expect.anything(),
      );
      expect(controller.getState()).toMatchObject({ step: 'preview-gate', cdf });
    });

    it('shows that it is computing while the preview runs', async () => {
      let during: string | undefined;
      steps.runPreview.mockImplementation(async () => {
        during = controllerRef?.getState().step;
        return { step: 'preview-gate', cdf };
      });
      const controllerRef = createFlowController(start(), deps());
      controllerRef.finalize(4, 0, 0);
      await controllerRef.submitPath('/out');

      expect(during).toBe('previewing');
    });

    it('does not show it is computing when credentials were skipped, since there is nothing to compute', async () => {
      const seen: string[] = [];
      steps.runPreview.mockResolvedValue({ step: 'done', serverPreview: null });
      const controller = createFlowController(start({ handoff: handoff(review, true) }), deps());
      controller.subscribe(() => seen.push(controller.getState().step));
      controller.finalize(4, 0, 0);
      await controller.submitPath('/out');

      expect(seen).not.toContain('previewing');
      expect(controller.getState().step).toBe('done');
    });

    it('asks the server to delete everything when nothing was accepted', async () => {
      await saved({}, 0);

      expect(steps.runPreview.mock.calls[0][0]).toMatchObject({ deleteAll: true });
    });

    it('previews straight away on the push route, which skips the review', async () => {
      const controller = createFlowController(start({ handoff: handoff({ route: 'push', acceptedCount: 0 }) }), deps());
      await controller.submitPath('/out');

      expect(steps.runPreview).toHaveBeenCalledTimes(1);
      expect(steps.runPrintFiles.mock.calls[0][0]).toMatchObject({ skipGate: true });
    });
  });

  describe('pushing', () => {
    const atGate = async () => {
      const controller = createFlowController(start(), deps());
      controller.finalize(4, 0, 0);
      await controller.submitPath('/out');
      return controller;
    };

    it('pushes the previewed document with the preview, and ends where the push ends', async () => {
      const serverPreview = { components: {}, tokens: {} } as never;
      steps.runPreview.mockResolvedValue({ step: 'preview-gate', cdf, serverPreview });
      const controller = await atGate();

      controller.confirmPreview(false);
      await vi.waitFor(() => expect(controller.getState().step).toBe('done'));

      expect(steps.runPush).toHaveBeenCalledWith(
        expect.objectContaining({
          cdf,
          spaceId: 'sp',
          environmentId: 'env',
          cmaToken: 'secret-token',
          host: 'api.example.com',
          acknowledgeBreakingChanges: false,
          preview: serverPreview,
        }),
        expect.anything(),
        expect.any(Function),
      );
    });

    it('passes on that breaking changes were acknowledged at the gate', async () => {
      const controller = await atGate();

      controller.confirmPreview(true);
      await vi.waitFor(() => expect(steps.runPush).toHaveBeenCalled());

      expect(steps.runPush.mock.calls[0][0]).toMatchObject({ acknowledgeBreakingChanges: true });
    });

    it('pushes with the breaking changes acknowledged when the user accepts them from the error screen', async () => {
      const controller = await atGate();

      controller.acknowledgeBreakingChanges();
      await vi.waitFor(() => expect(steps.runPush).toHaveBeenCalled());

      expect(steps.runPush.mock.calls[0][0]).toMatchObject({ acknowledgeBreakingChanges: true, cdf });
    });

    it('shows the progress the push reports while it runs', async () => {
      steps.runPush.mockImplementation(async (_i, _d, onPatch) => {
        onPatch({ step: 'pushing', pushProgress: { kind: 'queued', operationId: 'op-1' } });
        return { step: 'done' };
      });
      const controller = await atGate();
      const seen: Array<unknown> = [];
      controller.subscribe(() => seen.push(controller.getState().pushProgress));

      controller.confirmPreview(false);
      await vi.waitFor(() => expect(controller.getState().step).toBe('done'));

      expect(seen).toContainEqual({ kind: 'queued', operationId: 'op-1' });
    });

    it('does nothing when there is no document to push', () => {
      const controller = createFlowController(start(), deps());

      controller.confirmPreview(false);

      expect(steps.runPush).not.toHaveBeenCalled();
    });
  });

  describe('editing and skipping from the preview', () => {
    it('goes back to the review to edit the definitions', () => {
      const controller = createFlowController(start(), deps());
      controller.finalize(4, 0, 0);

      controller.editDefinitions();

      expect(controller.getState().step).toBe('final-review');
    });

    it('rejects the components that failed validation, once each, then previews again', async () => {
      steps.runPreview.mockResolvedValueOnce({
        step: 'preview-validation-error',
        previewValidationErrors: [
          { componentName: 'Button', message: 'a' },
          { componentName: 'Card', message: 'b' },
          { componentName: 'Button', message: 'c' },
        ],
      });
      const controller = createFlowController(start(), deps());
      controller.finalize(4, 0, 0);
      await controller.submitPath('/out');
      steps.runPreview.mockClear();

      await controller.skipValidationErrors();

      expect(rejectComponentsByName).toHaveBeenCalledWith('ext-1', ['Button', 'Card']);
      expect(steps.runPreview).toHaveBeenCalledTimes(1);
      expect(controller.getState().step).toBe('preview-gate');
    });

    it('still previews again, and rejects nothing, when there is nothing to skip', async () => {
      const controller = createFlowController(start(), deps());

      await controller.skipValidationErrors();

      expect(rejectComponentsByName).not.toHaveBeenCalled();
      expect(steps.runPreview).toHaveBeenCalledTimes(1);
    });
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

  describe('listening', () => {
    it('tells listeners about every change until they stop listening', () => {
      const controller = createFlowController(start(), deps());
      const listener = vi.fn();
      const stop = controller.subscribe(listener);

      controller.editDefinitions();
      expect(listener).toHaveBeenCalledTimes(1);

      stop();
      controller.editDefinitions();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('the step log', () => {
    it('writes every change, without the token', () => {
      const controller = createFlowController(start(), deps());
      log.mockClear();

      controller.finalize(4, 0, 0);

      expect(log).toHaveBeenCalledWith({
        update: expect.objectContaining({ step: 'path-prompt', generatedAcceptedCount: 4 }),
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
    });

    it('does not stop the import when the log cannot be written', () => {
      log.mockImplementation(() => {
        throw new Error('EROFS');
      });

      expect(createFlowController(start(), deps()).getState().step).toBe('final-review');
    });
  });
});

describe('what is logged for a change', () => {
  it('hides the token and the document', () => {
    expect(sanitizeForLog({ cmaToken: 'abc', cdf })).toEqual({ cmaToken: '[redacted]', cdf: '[cdf]' });
  });

  it('leaves other fields as they are', () => {
    expect(sanitizeForLog({ step: 'done', lastRunId: 'r' })).toEqual({ step: 'done', lastRunId: 'r' });
  });

  it('summarises a server preview as counts and names, not the whole response', () => {
    const preview = {
      components: {
        new: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
        changed: [
          {
            current: { name: 'D' },
            hasPendingDraftChanges: true,
            changeClassification: { classification: 'breaking', breakingChanges: [] },
            impact: undefined,
          },
        ],
        removed: [{ name: 'E' }, { name: 'F' }],
        unchanged: [{}, {}, {}, {}],
      },
      tokens: { new: [{}], changed: [], removed: [{}, {}], unchanged: [{}, {}, {}] },
    } as never;

    const logged = sanitizeForLog({ serverPreview: preview }) as { serverPreview: Record<string, unknown> };

    expect(logged.serverPreview['components']).toEqual({
      new: 3,
      newNames: ['A', 'B', 'C'],
      changed: 1,
      removed: 2,
      removedNames: ['E', 'F'],
      unchanged: 4,
    });
    expect(logged.serverPreview['tokens']).toEqual({ new: 1, changed: 0, removed: 2, unchanged: 3 });
    expect(logged.serverPreview['changedComponentDetails']).toEqual([
      expect.objectContaining({ name: 'D', hasPendingDraftChanges: true, classification: 'breaking' }),
    ]);
  });
});

describe('the components to skip after a failed validation', () => {
  it('names each once, in the order they first failed', () => {
    expect(namesToSkip([{ componentName: 'B' }, { componentName: 'A' }, { componentName: 'B' }] as never)).toEqual([
      'B',
      'A',
    ]);
  });

  it('is empty when nothing failed', () => {
    expect(namesToSkip([])).toEqual([]);
  });
});
