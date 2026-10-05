import { describe, expect, it, vi } from 'vitest';
import { createGenerateEndpoint } from '../../src/generate/controller/generate-endpoint.js';
import type { GenerateEndpointRequest } from '../../src/generate/model/endpoint.js';
import type { AgentInvoker } from '../../src/generate/services/ports/agent-invoker.js';

const requests: GenerateEndpointRequest[] = [
  {
    prompt: { skill: 'tokens', mode: 'autonomous', outDir: '/unused' },
    invocation: { agent: 'claude', timeoutMs: 1000 },
  },
  {
    prompt: { skill: 'select', mode: 'autonomous', outDir: '/unused' },
    invocation: { agent: 'claude', timeoutMs: 1000 },
  },
  {
    prompt: { skill: 'map-tokens', mode: 'autonomous', outDir: '/unused' },
    invocation: { agent: 'claude', timeoutMs: 1000 },
  },
];

describe('generate endpoint stage dispatch', () => {
  it.each(requests)('parses the $prompt.skill protocol with the matching parser', async (request) => {
    const output =
      request.prompt.skill === 'tokens'
        ? '{"tool":"set_group","path":"colors"}'
        : request.prompt.skill === 'select'
          ? '{"tool":"select_component","name":"Card"}'
          : '{"tool":"map_token_prop","component":"Card","prop":"color","token_allowed":["colors.brand.primary"]}';
    const invoker: AgentInvoker = {
      invoke: vi.fn().mockResolvedValue({ exitCode: 0, stdout: output, stderr: '', timedOut: false }),
      checkAuth: vi.fn(),
    };
    const endpoint = createGenerateEndpoint({
      invoker,
      promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
    });

    const response = await endpoint.execute(request);

    expect(response).toMatchObject({ stage: request.prompt.skill });
    expect(response.calls).toHaveLength(1);
    expect(response.failure).toBeUndefined();
  });

  it.each(['components', 'tokens', 'select'] as const)(
    'reports a failure when a successful %s run produces no tool calls',
    async (skill) => {
      const invoker: AgentInvoker = {
        invoke: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'prose only', stderr: '', timedOut: false }),
        checkAuth: vi.fn(),
      };
      const endpoint = createGenerateEndpoint({
        invoker,
        promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
      });

      const response = await endpoint.execute({
        prompt: { skill, mode: 'autonomous', outDir: '/unused' },
        invocation: { agent: 'claude', timeoutMs: 1000 },
      });

      expect(response.calls).toEqual([]);
      expect(response.failure).toBe('agent produced no tool calls — prose only');
    },
  );

  it('treats a successful map-tokens run with no suggestions as success', async () => {
    const invoker: AgentInvoker = {
      invoke: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'nothing to restrict', stderr: '', timedOut: false }),
      checkAuth: vi.fn(),
    };
    const endpoint = createGenerateEndpoint({
      invoker,
      promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
    });

    const response = await endpoint.execute({
      prompt: { skill: 'map-tokens', mode: 'autonomous', outDir: '/unused' },
      invocation: { agent: 'claude', timeoutMs: 1000 },
    });

    expect(response.calls).toEqual([]);
    expect(response.failure).toBeUndefined();
  });

  it('still reports a map-tokens failure when the agent exits non-zero', async () => {
    const invoker: AgentInvoker = {
      invoke: vi.fn().mockResolvedValue({ exitCode: 3, stdout: '', stderr: 'boom', timedOut: false }),
      checkAuth: vi.fn(),
    };
    const endpoint = createGenerateEndpoint({
      invoker,
      promptService: { buildPrompt: vi.fn().mockResolvedValue('PROMPT') },
    });

    const response = await endpoint.execute({
      prompt: { skill: 'map-tokens', mode: 'autonomous', outDir: '/unused' },
      invocation: { agent: 'claude', timeoutMs: 1000 },
    });

    expect(response.failure).toBe('agent exited with code 3 — boom');
  });
});
