import { beforeEach, describe, expect, it, vi } from 'vitest';

const agent = vi.hoisted(() => ({ invoke: vi.fn(), buildPrompt: vi.fn(async () => 'prompt') }));
vi.mock('../../../../agents/prompts/build-prompt.js', () => ({ buildPrompt: agent.buildPrompt }));
vi.mock('../../../../agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({ invoke: agent.invoke }),
}));

import { runCdfGenerationService } from '../../src/services/run-cdf-generation-service.js';

beforeEach(() => vi.clearAllMocks());

const component = (name: string) => ({
  name,
  framework: 'react' as const,
  source: `${name}.tsx`,
  props: [{ name: 'label', type: 'string', required: false, category: 'content' as const }],
  slots: [],
});

describe('CDF generation cancellation drain', () => {
  it('does not start a cache write when a warning callback cancels the invocation', async () => {
    const controller = new AbortController();
    const onCacheStore = vi.fn();
    const onWarning = vi.fn(() => controller.abort());
    agent.invoke.mockResolvedValueOnce({
      stdout: JSON.stringify({ tool: 'classify_prop', prop: 'label', cdf_type: 'invalid', cdf_category: 'content' }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    await expect(
      runCdfGenerationService({
        components: [component('Button')],
        agent: 'claude',
        signal: controller.signal,
        onWarning,
        onCacheStore,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onCacheStore).not.toHaveBeenCalled();
  });

  it('stops after canceled prompt preparation without invoking an agent', async () => {
    const controller = new AbortController();
    let finishPrompt!: (prompt: string) => void;
    agent.buildPrompt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPrompt = resolve;
        }),
    );

    const running = runCdfGenerationService({
      components: [component('Button')],
      agent: 'claude',
      skillContentOverride: 'prompt',
      signal: controller.signal,
      onCacheLookup: () => null,
      onCacheStore: vi.fn(),
    });
    await vi.waitFor(() => expect(agent.buildPrompt).toHaveBeenCalledOnce());
    controller.abort();
    finishPrompt('prepared prompt');

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(agent.invoke).not.toHaveBeenCalled();
  });

  it('waits for the active invocation, stops queued components, and never stores valid canceled output', async () => {
    const controller = new AbortController();
    let finishInvocation!: (result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }) => void;
    agent.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInvocation = resolve;
        }),
    );
    const onCacheStore = vi.fn();
    const running = runCdfGenerationService({
      components: [component('Button'), component('Card')],
      agent: 'claude',
      concurrency: 1,
      skillContentOverride: 'prompt',
      signal: controller.signal,
      onCacheLookup: () => null,
      onCacheStore,
    });
    await vi.waitFor(() => expect(agent.invoke).toHaveBeenCalledTimes(1));

    controller.abort();
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    finishInvocation({
      stdout: JSON.stringify({ tool: 'classify_prop', prop: 'label', cdf_type: 'text', cdf_category: 'content' }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(agent.invoke).toHaveBeenCalledTimes(1);
    expect(onCacheStore).not.toHaveBeenCalled();
  });
});
