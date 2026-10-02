import { describe, expect, it, vi } from 'vitest';
import { createGenerateEndpoint } from '../../src/generate/controller/generate-endpoint.js';
import type { GenerateEndpointRequest } from '../../src/generate/model/endpoint.js';
import type { AgentInvoker } from '../../src/generate/services/ports/agent-invoker.js';

function createInvoker(stdout: string, overrides: Partial<Awaited<ReturnType<AgentInvoker['invoke']>>> = {}) {
  return {
    invoke: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout,
      stderr: '',
      timedOut: false,
      ...overrides,
    }),
    checkAuth: vi.fn(),
  } satisfies AgentInvoker;
}

function componentsRequest(overrides: { dryRun?: boolean } = {}): GenerateEndpointRequest {
  return {
    stage: 'components',
    prompt: { skill: 'components', mode: 'autonomous', outDir: '/unused' },
    invocation: { agent: 'claude', timeoutMs: 1000 },
    ...overrides,
  };
}

describe('generate endpoint', () => {
  it('builds one prompt, invokes once, and parses the component protocol', async () => {
    const invoker = createInvoker('{"tool":"classify_component","description":"Card"}');
    const buildPrompt = vi.fn().mockResolvedValue('PROMPT');
    const endpoint = createGenerateEndpoint({ invoker, promptService: { buildPrompt } });

    const response = await endpoint.execute(componentsRequest());

    expect(buildPrompt).toHaveBeenCalledWith(componentsRequest().prompt);
    expect(invoker.invoke).toHaveBeenCalledWith({ agent: 'claude', timeoutMs: 1000, prompt: 'PROMPT' });
    expect(response).toMatchObject({
      stage: 'components',
      dryRun: false,
      prompt: 'PROMPT',
      calls: [{ tool: 'classify_component', description: 'Card' }],
      warnings: [],
    });
    if (response.dryRun) throw new Error('expected an executed response');
    expect(response.failure).toBeUndefined();
    expect(response.run.exitCode).toBe(0);
  });

  it('returns the prompt without invoking an agent for dry-run requests', async () => {
    const invoker = createInvoker('should not be read');
    const buildPrompt = vi.fn().mockResolvedValue('PROMPT ONLY');
    const endpoint = createGenerateEndpoint({ invoker, promptService: { buildPrompt } });

    const response = await endpoint.execute({ ...componentsRequest(), dryRun: true });

    expect(response).toEqual({ stage: 'components', dryRun: true, prompt: 'PROMPT ONLY' });
    expect(invoker.invoke).not.toHaveBeenCalled();
  });

  it('preserves non-zero runs and parsed output while exposing a failure diagnostic', async () => {
    const invoker = createInvoker('{"tool":"classify_component"}', {
      exitCode: 2,
      stderr: 'agent failed',
    });
    const endpoint = createGenerateEndpoint({
      invoker,
      promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
    });

    const response = await endpoint.execute(componentsRequest());

    expect(response).toMatchObject({
      dryRun: false,
      calls: [{ tool: 'classify_component' }],
      failure: 'agent exited with code 2 — agent failed',
    });
    if (response.dryRun) throw new Error('expected an executed response');
    expect(response.run).toMatchObject({ exitCode: 2, stderr: 'agent failed' });
  });

  it('preserves timeout metadata as a distinct failure from a non-zero exit', async () => {
    const invoker = createInvoker('{"tool":"classify_component"}', {
      exitCode: 1,
      timedOut: true,
    });
    const endpoint = createGenerateEndpoint({
      invoker,
      promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
    });

    const response = await endpoint.execute(componentsRequest());

    expect(response).toMatchObject({ dryRun: false, failure: 'agent timed out' });
    if (response.dryRun) throw new Error('expected an executed response');
    expect(response.run.timedOut).toBe(true);
  });

  it('distinguishes an empty successful run from a parsed run', async () => {
    const invoker = createInvoker('prose only');
    const endpoint = createGenerateEndpoint({
      invoker,
      promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
    });

    const response = await endpoint.execute(componentsRequest());

    expect(response).toMatchObject({ dryRun: false, calls: [], failure: 'agent produced no tool calls — prose only' });
  });

  it('validates the stage before building a prompt or invoking an agent', async () => {
    const invoker = createInvoker('');
    const buildPrompt = vi.fn().mockResolvedValue('PROMPT');
    const endpoint = createGenerateEndpoint({ invoker, promptService: { buildPrompt } });

    await expect(
      endpoint.execute({
        stage: 'tokens',
        prompt: { skill: 'components', mode: 'autonomous', outDir: '/unused' },
        invocation: { agent: 'claude', timeoutMs: 1000 },
      } as unknown as GenerateEndpointRequest),
    ).rejects.toThrow('does not match prompt skill');
    expect(buildPrompt).not.toHaveBeenCalled();
    expect(invoker.invoke).not.toHaveBeenCalled();
  });

  it('propagates prompt failures without invoking the agent', async () => {
    const invoker = createInvoker('');
    const buildPrompt = vi.fn().mockRejectedValue(new Error('prompt failed'));
    const endpoint = createGenerateEndpoint({ invoker, promptService: { buildPrompt } });

    await expect(endpoint.execute(componentsRequest())).rejects.toThrow('prompt failed');
    expect(invoker.invoke).not.toHaveBeenCalled();
  });
});
