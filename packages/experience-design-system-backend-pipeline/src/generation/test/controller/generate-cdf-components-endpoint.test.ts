import { describe, expect, it } from 'vitest';
import { generateCdfComponents } from '../../controller/generate-cdf-components-endpoint.js';

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

  it('passes validation and delegates to service with valid agent', async () => {
    await expect(generateCdfComponents({ components: [{ name: 'Button' } as never], agent: 'claude' })).rejects.toThrow(
      'runCdfGenerationService not yet implemented',
    );
  });

  it('uses claude as default when agent is omitted', async () => {
    await expect(generateCdfComponents({ components: [{ name: 'Button' } as never] })).rejects.toThrow(
      'runCdfGenerationService not yet implemented',
    );
  });
});
