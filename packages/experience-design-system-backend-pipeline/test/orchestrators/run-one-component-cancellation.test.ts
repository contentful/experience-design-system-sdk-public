import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  renameEmptySlots: vi.fn(() => ({ renames: [] })),
  loadSavedComponentSourceRef: vi.fn(),
  buildPrompt: vi.fn(),
  invokeAgentWithOutput: vi.fn(),
  copyComponentFromCache: vi.fn(),
  resolveComponentCache: vi.fn(),
  computeComponentInputHash: vi.fn(() => 'component-hash'),
  storeCache: vi.fn(),
}));
vi.mock('../../src/persistence/src/session/repositories/db.js', () => ({
  renameEmptySlots: deps.renameEmptySlots,
  loadSavedComponentSourceRef: deps.loadSavedComponentSourceRef,
  copyComponentFromCache: deps.copyComponentFromCache,
  computeComponentInputHash: deps.computeComponentInputHash,
  storeCache: deps.storeCache,
}));
vi.mock('../../src/steps/generation/src/helpers/components/resolve-component-cache.js', () => ({
  resolveComponentCache: deps.resolveComponentCache,
}));
vi.mock('../../src/agents/prompts/build-prompt.js', () => ({ buildPrompt: deps.buildPrompt }));
vi.mock('../../src/agents/services/invoke-agent-with-output.js', () => ({
  invokeAgentWithOutput: deps.invokeAgentWithOutput,
}));

import { runOneGenerateComponent } from '../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';

beforeEach(() => {
  vi.clearAllMocks();
  deps.renameEmptySlots.mockReturnValue({ renames: [] });
  deps.loadSavedComponentSourceRef.mockReturnValue({ sourcePath: 'src/Button.tsx', props: [] });
  deps.buildPrompt.mockResolvedValue('prompt');
  deps.resolveComponentCache.mockReset();
});

const component = {
  component_id: 1,
  name: 'Button',
  source: 'src/Button.tsx',
  sourcePath: 'src/Button.tsx',
  framework: 'react',
  props: [{ name: 'label', type: 'string', required: false }],
  slots: [],
} as never;

const options = (signal: AbortSignal) =>
  ({
    db: {} as never,
    sessionId: 'session',
    invoker: {} as never,
    agent: 'claude',
    model: undefined,
    tokensInline: undefined,
    tokenMapInline: undefined,
    verbose: false,
    noCache: true,
    skillPathOverride: undefined,
    skillContentOverride: 'test prompt',
    promptHash: 'prompt-hash',
    existingContentfulEntities: undefined,
    existingTokensInline: undefined,
    precomputedCachedNames: new Set<string>(),
    allowedComponentNames: new Set(['Button']),
    onProgress: undefined,
    signal,
  }) as never;

describe('component generation preparation cancellation', () => {
  it('does not rename slots or prepare a pre-aborted component', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runOneGenerateComponent(options(controller.signal), component, 0, 1)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(deps.renameEmptySlots).not.toHaveBeenCalled();
    expect(deps.loadSavedComponentSourceRef).not.toHaveBeenCalled();
    expect(deps.invokeAgentWithOutput).not.toHaveBeenCalled();
  });

  it('cancels component retry backoff and clears its timer and listener', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
      deps.invokeAgentWithOutput.mockResolvedValueOnce({
        result: { stdout: '', stderr: 'failed', exitCode: 1, timedOut: false },
      });
      const running = runOneGenerateComponent(options(controller.signal), component, 0, 1);
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
      expect(deps.invokeAgentWithOutput).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(1);

      controller.abort();
      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
      expect(deps.invokeAgentWithOutput).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['precomputed', 'restored', 'human-edited'])(
    'does not publish %s cache success after progress cancellation',
    async (branch) => {
      const controller = new AbortController();
      if (branch !== 'precomputed') {
        deps.resolveComponentCache.mockReturnValueOnce({
          humanEdited: branch === 'human-edited',
          entry: { sourceSessionId: 'cached-session', humanEdited: false },
        });
      }
      const request = {
        ...(options(controller.signal) as Parameters<typeof runOneGenerateComponent>[0]),
        noCache: false,
        precomputedCachedNames: new Set(branch === 'precomputed' ? ['Button'] : []),
        onProgress: () => controller.abort(),
      };

      await expect(runOneGenerateComponent(request, component, 0, 1)).rejects.toMatchObject({ name: 'AbortError' });
      expect(deps.invokeAgentWithOutput).not.toHaveBeenCalled();
    },
  );

  it('does not restore cached component data after a progress callback cancels the component', async () => {
    const controller = new AbortController();
    deps.renameEmptySlots.mockReturnValueOnce({ renames: [{ oldName: '', newName: 'content' }] } as never);
    deps.resolveComponentCache.mockReturnValueOnce({ humanEdited: true, entry: { sourceSessionId: 'cached-session' } });
    const request = {
      ...(options(controller.signal) as Parameters<typeof runOneGenerateComponent>[0]),
      noCache: false,
      onProgress: () => controller.abort(),
    };
    const slotted = {
      ...(component as Parameters<typeof runOneGenerateComponent>[1]),
      slots: [{ name: '', isDefault: true }],
    };

    await expect(runOneGenerateComponent(request, slotted, 0, 1)).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.copyComponentFromCache).not.toHaveBeenCalled();
  });

  it('does not build a prompt or invoke after cancellation during saved source projection', async () => {
    const controller = new AbortController();
    deps.loadSavedComponentSourceRef.mockImplementationOnce(() => {
      controller.abort();
      return { sourcePath: 'src/Button.tsx', props: [] };
    });

    await expect(runOneGenerateComponent(options(controller.signal), component, 0, 1)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(deps.loadSavedComponentSourceRef).toHaveBeenCalledOnce();
    expect(deps.buildPrompt).not.toHaveBeenCalled();
    expect(deps.invokeAgentWithOutput).not.toHaveBeenCalled();
  });

  it('does not invoke after cancellation while waiting for prompt preparation', async () => {
    const controller = new AbortController();
    let finishPrompt!: (prompt: string) => void;
    deps.buildPrompt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPrompt = resolve;
        }),
    );
    const running = runOneGenerateComponent(options(controller.signal), component, 0, 1);
    await vi.waitFor(() => expect(deps.buildPrompt).toHaveBeenCalledOnce());
    controller.abort();
    finishPrompt('prepared prompt');

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.invokeAgentWithOutput).not.toHaveBeenCalled();
  });
});
