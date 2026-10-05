import { describe, expect, it, vi } from 'vitest';
import type { AgentInvoker } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { createSelectionAgentDispatcher } from '../src/agent-dispatch.js';

const component = {
  name: 'Card',
  source: '/components/Card.tsx',
  framework: 'react',
  props: [],
  slots: [],
} satisfies RawComponentDefinition;

describe('selection agent dispatch', () => {
  it('reuses the injected invoker and maps the existing selection protocol', async () => {
    const invoker: AgentInvoker = {
      invoke: vi.fn(async (options) => {
        expect(options.prompt).toBe('selection prompt');
        return {
          exitCode: 0,
          stdout: '{"tool":"select_component","name":"Card","reason":"visible UI"}',
          stderr: '',
          timedOut: false,
        };
      }),
      checkAuth: vi.fn(),
    };
    const dispatch = createSelectionAgentDispatcher({
      invoker,
      agent: 'claude',
      timeoutMs: 10_000,
      outDir: '/tmp/selection-run',
      buildPrompt: vi.fn(async () => 'selection prompt'),
    });

    await expect(dispatch(component, 0)).resolves.toEqual({
      componentKey: 'Card::/components/Card.tsx',
      decision: 'accepted',
      reason: 'visible UI',
    });
    expect(invoker.invoke).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the agent does not return a decision for the component', async () => {
    const invoker: AgentInvoker = {
      invoke: vi.fn(async () => ({
        exitCode: 0,
        stdout: '{"tool":"select_component","name":"Other"}',
        stderr: '',
        timedOut: false,
      })),
      checkAuth: vi.fn(),
    };
    const dispatch = createSelectionAgentDispatcher({
      invoker,
      agent: 'claude',
      timeoutMs: 10_000,
      outDir: '/tmp/selection-run',
      buildPrompt: async () => 'selection prompt',
    });

    await expect(dispatch(component, 0)).rejects.toThrow('no decision for Card');
  });
});
