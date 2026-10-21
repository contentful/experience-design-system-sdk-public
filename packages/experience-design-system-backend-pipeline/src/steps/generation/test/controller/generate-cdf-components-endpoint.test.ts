import { beforeEach, describe, expect, it, vi } from 'vitest';
const agent = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../../../agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => agent,
}));
beforeEach(() => {
  agent.invoke.mockReset();
  agent.invoke.mockResolvedValue({
    stdout: JSON.stringify({ tool: 'classify_component' }),
    stderr: '',
    exitCode: 0,
    timedOut: false,
  });
});
import { generateCdfComponents } from '../../src/controller/generate-cdf-components-endpoint.js';

const expectedEntry = { $type: 'component' as const, $properties: {} };

describe('generateCdfComponents validation', () => {
  it('returns empty result immediately when components array is empty', async () => {
    const result = await generateCdfComponents({ components: [] });
    expect(result).toEqual({ components: [], warnings: [], failures: [] });
  });

  it('throws for an unknown agent name', async () => {
    await expect(
      generateCdfComponents({ components: [{ name: 'Button' } as never], agent: 'not-a-real-agent' }),
    ).rejects.toThrow('Unknown agent: "not-a-real-agent"');
  });

  it('passes validation and computes a fresh saved result with valid agent', async () => {
    const lookup = vi.fn(() => expectedEntry);
    const store = vi.fn();
    const result = await generateCdfComponents({
      components: [{ name: 'Button', props: [], slots: [], framework: 'react' } as never],
      agent: 'claude',
      onCacheLookup: lookup,
      onCacheStore: store,
    });
    expect(result).toMatchObject({ components: [expectedEntry], warnings: [], failures: [] });
    expect(agent.invoke).toHaveBeenCalledOnce();
    expect(agent.invoke.mock.calls[0]![0].agent).toBe('claude');
    expect(lookup).not.toHaveBeenCalled();
    expect(store).toHaveBeenCalledWith(expect.any(String), expect.any(String), expectedEntry);
  });

  it('uses claude as default when agent is omitted', async () => {
    const lookup = vi.fn(() => expectedEntry);
    const store = vi.fn();
    const result = await generateCdfComponents({
      components: [{ name: 'Card', props: [], slots: [], framework: 'react' } as never],
      onCacheLookup: lookup,
      onCacheStore: store,
    });
    expect(result).toMatchObject({ components: [expectedEntry], warnings: [], failures: [] });
    expect(agent.invoke).toHaveBeenCalledOnce();
    expect(agent.invoke.mock.calls[0]![0].agent).toBe('claude');
    expect(lookup).not.toHaveBeenCalled();
    expect(store).toHaveBeenCalledWith(expect.any(String), expect.any(String), expectedEntry);
  });
});
