import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createGenerateEndpoint } from '../../src/generate/controller/generate-endpoint.js';
import { GenerateRequestError } from '../../src/generate/model/errors.js';
import type { GenerateEndpointRequest } from '../../src/generate/model/endpoint.js';
import type { ToolCall } from '../../src/generate/model/protocol.js';
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

function componentsRequest(): GenerateEndpointRequest<'components'> {
  return {
    prompt: { skill: 'components', mode: 'autonomous', outDir: '/unused' },
    invocation: { agent: 'claude', timeoutMs: 1000 },
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
      prompt: 'PROMPT',
      calls: [{ tool: 'classify_component', description: 'Card' }],
      warnings: [],
    });
    expect(response.failure).toBeUndefined();
    expect(response.run.exitCode).toBe(0);
  });

  it('previews the prompt without invoking an agent', async () => {
    const invoker = createInvoker('should not be read');
    const buildPrompt = vi.fn().mockResolvedValue('PROMPT ONLY');
    const endpoint = createGenerateEndpoint({ invoker, promptService: { buildPrompt } });

    const response = await endpoint.preview({ prompt: componentsRequest().prompt });

    expect(response).toEqual({ stage: 'components', prompt: 'PROMPT ONLY' });
    expect(invoker.invoke).not.toHaveBeenCalled();
  });

  it('propagates prompt failures from a preview without invoking the agent', async () => {
    const invoker = createInvoker('');
    const buildPrompt = vi.fn().mockRejectedValue(new Error('prompt failed'));
    const endpoint = createGenerateEndpoint({ invoker, promptService: { buildPrompt } });

    await expect(endpoint.preview({ prompt: componentsRequest().prompt })).rejects.toThrow('prompt failed');
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
      calls: [{ tool: 'classify_component' }],
      failure: 'agent exited with code 2 — agent failed',
    });
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

    expect(response).toMatchObject({ failure: 'agent timed out' });
    expect(response.run.timedOut).toBe(true);
  });

  it('distinguishes an empty successful run from a parsed run', async () => {
    const invoker = createInvoker('prose only');
    const endpoint = createGenerateEndpoint({
      invoker,
      promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
    });

    const response = await endpoint.execute(componentsRequest());

    expect(response).toMatchObject({ calls: [], failure: 'agent produced no tool calls — prose only' });
  });

  it('derives the stage from the prompt skill and types the result for that stage', async () => {
    const endpoint = createGenerateEndpoint({
      invoker: createInvoker('{"tool":"classify_component"}'),
      promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
    });

    const response = await endpoint.execute(componentsRequest());

    expect(response.stage).toBe('components');
    expectTypeOf(response.stage).toEqualTypeOf<'components'>();
    expectTypeOf(response.calls).toEqualTypeOf<ToolCall[]>();
    expectTypeOf(response.run.exitCode).toEqualTypeOf<number>();
  });

  it('does not accept a stage that can disagree with the prompt skill', () => {
    const request: GenerateEndpointRequest<'components'> = {
      // @ts-expect-error the stage is derived from prompt.skill and is not part of the request
      stage: 'tokens',
      prompt: { skill: 'components', mode: 'autonomous', outDir: '/unused' },
      invocation: { agent: 'claude', timeoutMs: 1000 },
    };
    expect(request.prompt.skill).toBe('components');
  });

  it('rejects an unknown stage with a typed error before building a prompt or invoking an agent', async () => {
    const invoker = createInvoker('');
    const buildPrompt = vi.fn().mockResolvedValue('PROMPT');
    const endpoint = createGenerateEndpoint({ invoker, promptService: { buildPrompt } });
    const request = {
      prompt: { skill: 'bogus', mode: 'autonomous', outDir: '/unused', skillContentOverride: 'x' },
      invocation: { agent: 'claude', timeoutMs: 1000 },
    } as unknown as GenerateEndpointRequest;

    const error = await endpoint.execute(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerateRequestError);
    expect(error).toMatchObject({ reason: 'unknown-stage', stage: 'bogus' });
    await expect(endpoint.preview(request)).rejects.toBeInstanceOf(GenerateRequestError);
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
