import { Text } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../helpers/plain-render.js';
import {
  initialFlowState,
  type FlowController,
  type FlowStart,
} from '../../../src/tui/import/steps/10-flow/flow/controller.js';
import { canEditFromPreview, FlowScreen, totalStepsFor } from '../../../src/tui/import/steps/10-flow/flow/screen.js';
import type { FlowState } from '../../../src/tui/import/steps/10-flow/flow/types.js';

vi.mock('../../../src/tui/import/steps/09-review/generate-review-step.js', () => ({
  GenerateReviewStep: (props: {
    extractSessionId: string | null;
    onFinalize: (a: number, r: number, u: number) => void;
  }) => {
    props.onFinalize(7, 1, 2);
    return <Text>review for {props.extractSessionId}</Text>;
  },
}));

const start: FlowStart = {
  handoff: {
    credentialsSkipped: false,
    tokens: { strategy: 'generate' },
    extraction: {
      sessionId: 'ext-1',
      outDir: '/p/.contentful',
      tokensPath: '/p/.contentful/tokens.json',
      tokenSessionId: null,
      tokenCount: 0,
      existingEntitiesPath: null,
      existingEntitiesStatus: 'idle',
      compositionPhase: 'done',
    },
    generation: { route: 'review', sessionId: 'gen-1', acceptedCount: 1, generatedCount: 1, mapTokensEligible: false },
  },
  agent: 'claude',
  projectPath: '/p',
  outDir: '/out',
  rawTokensPath: '',
  credentials: { spaceId: 'sp', environmentId: 'master', cmaToken: 't', host: 'api.contentful.com' },
};
const base = initialFlowState(start);
const withState = (patch: Partial<FlowState>): FlowState => ({ ...base, ...patch });

const controller = (): FlowController => ({
  getState: () => base,
  subscribe: () => () => undefined,
  finalize: vi.fn(),
  submitPath: vi.fn().mockResolvedValue(undefined),
  confirmPreview: vi.fn(),
  acknowledgeBreakingChanges: vi.fn(),
  editDefinitions: vi.fn(),
  skipValidationErrors: vi.fn().mockResolvedValue(undefined),
});

const preview = {
  components: { new: [{ key: 'Fresh' }], changed: [], removed: [], unchanged: [] },
  tokens: { new: [], changed: [], removed: [], unchanged: [] },
} as never;
const cdfWith = {
  $schema: 'https://contentful.com/schemas/cdf',
  Button: { $type: 'component', $properties: {} },
} as never;
const cdfEmpty = { $schema: 'https://contentful.com/schemas/cdf' } as never;

const show = (
  patch: Partial<FlowState>,
  extra: { onExit?: (code: number) => void; c?: FlowController; prompt?: string } = {},
) =>
  render(
    <FlowScreen
      state={withState(patch)}
      controller={extra.c ?? controller()}
      onExit={extra.onExit ?? vi.fn()}
      generatePromptPath={extra.prompt}
    />,
  );
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('how many steps the import has', () => {
  it('counts the three fixed ones and the two of components', () => {
    expect(totalStepsFor({ tokensPath: '', rawTokensPath: '', mapTokensEligible: null })).toBe(5);
  });
  it('adds one for tokens, whether they came from a file or were already generated', () => {
    expect(totalStepsFor({ tokensPath: '/t.json', rawTokensPath: '', mapTokensEligible: false })).toBe(6);
    expect(totalStepsFor({ tokensPath: '', rawTokensPath: '/raw.json', mapTokensEligible: false })).toBe(6);
  });
  it('adds one more when tokens are mapped, and only when that is certain', () => {
    expect(totalStepsFor({ tokensPath: '/t.json', rawTokensPath: '', mapTokensEligible: true })).toBe(7);
    expect(totalStepsFor({ tokensPath: '/t.json', rawTokensPath: '', mapTokensEligible: null })).toBe(6);
  });
});

describe('when the preview gate offers to edit', () => {
  it('does for a document with components', () => expect(canEditFromPreview(cdfWith)).toBe(true));
  it('does not for an empty one, since editing would dead-end', () => expect(canEditFromPreview(cdfEmpty)).toBe(false));
  it('does not without a document', () => expect(canEditFromPreview(null)).toBe(false));
});

describe('the flow screen', () => {
  it('shows the review for the extraction session, and passes finalize through', () => {
    const c = controller();
    const { lastFrame } = show({ step: 'final-review' }, { c });

    expect(lastFrame()).toContain('review for ext-1');
    expect(c.finalize).toHaveBeenCalledWith(7, 1, 2);
  });

  it('shows the diff being computed', () => {
    expect(show({ step: 'previewing' }).lastFrame()).toContain('Computing diff');
  });

  it('shows the preview with the space and environment', () => {
    const frame = show({
      step: 'preview-gate',
      serverPreview: preview,
      cdf: cdfWith,
      spaceId: 'sp-77',
      environmentId: 'staging',
    }).lastFrame();

    expect(frame).toContain('Fresh');
    expect(frame).toContain('sp-77');
  });

  it('offers to edit definitions from the preview only when there is something to edit', () => {
    expect(show({ step: 'preview-gate', serverPreview: preview, cdf: cdfWith }).lastFrame()).toContain('Edit');
    expect(show({ step: 'preview-gate', serverPreview: preview, cdf: cdfEmpty }).lastFrame()).not.toContain('Edit');
  });

  it('shows nothing for a preview gate that has no preview', () => {
    expect(show({ step: 'preview-gate', serverPreview: null }).lastFrame()).toBe('');
  });

  it('shows the push, with the operation once it is queued', () => {
    const frame = show({ step: 'pushing', pushProgress: { kind: 'queued', operationId: 'op-42' } }).lastFrame();

    expect(frame).toContain('Push to Contentful');
    expect(frame).toContain('op-42');
  });

  it('asks where to save, starting from the default folder', () => {
    expect(show({ step: 'path-prompt', outDir: '/default/out' }).lastFrame()).toContain('/default/out');
  });

  it('submits the chosen path to the controller', async () => {
    const c = controller();
    const { stdin } = show({ step: 'path-prompt', outDir: '/default/out' }, { c });
    await tick();
    stdin.write('\r');
    await tick();

    expect(c.submitPath).toHaveBeenCalledWith('/default/out');
  });

  it('shows the files being written', () => {
    expect(show({ step: 'printing' }).lastFrame()).toContain('Writing files');
  });

  it('confirms the saved file, and exits cleanly from it', async () => {
    const onExit = vi.fn();
    const { lastFrame, stdin } = show({ step: 'print-gate', componentsPath: '/out/components.json' }, { onExit });

    expect(lastFrame()).toContain('Files saved');
    expect(lastFrame()).toContain('[Enter] Exit');
    expect(lastFrame()).toContain('components.json → /out/components.json');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it('mentions the saved run when there is one, and how to push later when there is not', () => {
    expect(show({ step: 'print-gate', lastRunId: 'run-5' }).lastFrame()).toContain('Run saved as run-5.');
    expect(show({ step: 'print-gate', lastRunId: null }).lastFrame()).toContain('Run `experiences import` again');
  });

  it('shows the result of the push', () => {
    const frame = show({
      step: 'done',
      pushResult: {
        componentTypes: { created: 3, updated: 0, removed: 0, failed: 0 },
        designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
      },
    }).lastFrame();

    expect(frame).toContain('3 Component Types created');
  });

  it('exits with success when nothing failed, and with failure when something did', async () => {
    const ok = vi.fn();
    const okScreen = show(
      {
        step: 'done',
        pushResult: {
          componentTypes: { created: 1, updated: 0, removed: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
        },
      },
      { onExit: ok },
    );
    await tick();
    okScreen.stdin.write('\r');
    await tick();
    expect(ok).toHaveBeenCalledWith(0);

    for (const failed of [
      { componentTypes: 1, designTokens: 0 },
      { componentTypes: 0, designTokens: 2 },
    ]) {
      const onExit = vi.fn();
      const screen = show(
        {
          step: 'done',
          pushResult: {
            componentTypes: { created: 0, updated: 0, removed: 0, failed: failed.componentTypes },
            designTokens: { created: 0, updated: 0, removed: 0, failed: failed.designTokens },
          },
        },
        { onExit },
      );
      await tick();
      screen.stdin.write('\r');
      await tick();
      expect(onExit).toHaveBeenCalledWith(1);
    }
  });

  it('shows the components that failed validation', () => {
    const frame = show({
      step: 'preview-validation-error',
      previewValidationErrors: [{ componentName: 'Button', message: 'bad prop' } as never],
      previewValidationMissingNames: [],
    }).lastFrame();

    expect(frame).toContain('Preview validation failed');
  });

  it('shows an error, and exits with failure from it', async () => {
    const onExit = vi.fn();
    const { lastFrame, stdin } = show({ step: 'error', errorStep: 'apply', errorMessage: 'it broke' }, { onExit });

    expect(lastFrame()).toContain('apply failed');
    expect(lastFrame()).toContain('it broke');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it('offers to acknowledge breaking changes only when allowed and there is a document to push', () => {
    const allowed = show({
      step: 'error',
      errorAllowBreakingChangeAcknowledgment: true,
      cdf: cdfWith,
      errorMessage: 'x',
    }).lastFrame();
    const noDocument = show({
      step: 'error',
      errorAllowBreakingChangeAcknowledgment: true,
      cdf: null,
      errorMessage: 'x',
    }).lastFrame();
    const notAllowed = show({
      step: 'error',
      errorAllowBreakingChangeAcknowledgment: false,
      cdf: cdfWith,
      errorMessage: 'x',
    }).lastFrame();

    expect(allowed).toContain('cknowledge');
    expect(noDocument).not.toContain('cknowledge');
    expect(notAllowed).not.toContain('cknowledge');
  });

  it('warns that a custom prompt is active, above whichever step is showing', () => {
    const frame = show({ step: 'printing' }, { prompt: '/my/prompt.md' }).lastFrame();

    expect(frame).toContain('Custom prompt active');
    expect(frame).toContain('/my/prompt.md');
    expect(show({ step: 'printing' }).lastFrame()).not.toContain('Custom prompt active');
  });
});
