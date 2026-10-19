import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  run: vi.fn(async (_request: { signal?: AbortSignal }) => ({ components: [], warnings: [], failures: [] })),
}));
vi.mock('../../src/services/run-cdf-generation-service.js', () => ({ runCdfGenerationService: service.run }));

import { generateCdfComponents } from '../../src/controller/generate-cdf-components-endpoint.js';

beforeEach(() => vi.clearAllMocks());

describe('CDF endpoint cancellation contract', () => {
  it('forwards the request signal to the generation service', async () => {
    const controller = new AbortController();
    const component = {
      name: 'Button',
      framework: 'react',
      source: 'Button.tsx',
      props: [],
      slots: [],
    };

    await generateCdfComponents({ components: [component] as never, agent: 'claude', signal: controller.signal });

    expect(service.run).toHaveBeenCalledOnce();
    expect(service.run.mock.calls[0]?.[0].signal).toBe(controller.signal);
  });

  it('does not enter the service for a pre-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateCdfComponents({ components: [{ name: 'Button' }] as never, agent: 'claude', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(service.run).not.toHaveBeenCalled();
  });
});
