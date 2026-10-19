import { describe, expect, it, vi } from 'vitest';
import { runCdfGenerationService } from '../../src/services/run-cdf-generation-service.js';

describe('cancellation remainder — CDF generation', () => {
  it('observes pre-abort before prompt preparation and cache callbacks', async () => {
    const controller = new AbortController();
    controller.abort();
    const onCacheLookup = vi.fn(() => ({ $type: 'component' as const, $properties: {} }));

    await expect(
      runCdfGenerationService({
        components: [{ name: 'Button', framework: 'react', source: '', props: [], slots: [] } as never],
        agent: 'claude',
        skillContentOverride: 'prompt',
        onCacheLookup,
        signal: controller.signal,
      } as never),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(onCacheLookup).not.toHaveBeenCalled();
  });
});
