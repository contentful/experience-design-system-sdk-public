import { describe, expect, it, vi } from 'vitest';
import { createGenerateEndpoint } from '../../src/generate/controller/generate-endpoint.js';
import type { GenerateEndpointRequest } from '../../src/generate/model/endpoint.js';
import type { AgentInvoker } from '../../src/generate/services/ports/agent-invoker.js';

const requests: GenerateEndpointRequest[] = [
  {
    stage: 'tokens',
    prompt: { skill: 'tokens', mode: 'autonomous', outDir: '/unused' },
    invocation: { agent: 'claude', timeoutMs: 1000 },
  },
  {
    stage: 'select',
    prompt: { skill: 'select', mode: 'autonomous', outDir: '/unused' },
    invocation: { agent: 'claude', timeoutMs: 1000 },
  },
  {
    stage: 'map-tokens',
    prompt: { skill: 'map-tokens', mode: 'autonomous', outDir: '/unused' },
    invocation: { agent: 'claude', timeoutMs: 1000 },
  },
];

describe('generate endpoint stage dispatch', () => {
  it.each(requests)('parses the $stage protocol with the matching parser', async (request) => {
    const output =
      request.stage === 'tokens'
        ? '{"tool":"set_group","path":"colors"}'
        : request.stage === 'select'
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

    expect(response).toMatchObject({ stage: request.stage, dryRun: false });
    if (response.dryRun) throw new Error('expected an executed response');
    expect(response.calls).toHaveLength(1);
  });
});
