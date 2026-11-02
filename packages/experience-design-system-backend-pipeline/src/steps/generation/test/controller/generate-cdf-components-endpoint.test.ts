import { describe, expect, it } from 'vitest';
import { generateCdfComponents } from '../../src/controller/generate-cdf-components-endpoint.js';

const cachedEntry = { $type: 'component' as const, $properties: {} };

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
    const result = await generateCdfComponents({
      components: [{ name: 'Button', props: [], slots: [], framework: 'react' } as never],
      agent: 'claude',
      onCacheLookup: () => cachedEntry,
    });
    expect(result).toMatchObject({ components: [cachedEntry], warnings: [], failures: [] });
  });

  it('uses claude as default when agent is omitted', async () => {
    const result = await generateCdfComponents({
      components: [{ name: 'Card', props: [], slots: [], framework: 'react' } as never],
      onCacheLookup: () => cachedEntry,
    });
    expect(result).toMatchObject({ components: [cachedEntry], warnings: [], failures: [] });
  });

  // A definition cached before the fix has a token property with no kind, which the API rejects. It must come out with one.
  it('gives a token property that has no kind its kind from the token file, even from the cache', async () => {
    const cached = {
      $type: 'component' as const,
      $properties: { color: { $type: 'token' as const, $category: 'design' as const } },
    };

    const result = await generateCdfComponents({
      components: [{ name: 'Button', props: [], slots: [], framework: 'react' } as never],
      tokens: [{ path: 'color.background', $type: 'color', $value: 'x' }],
      onCacheLookup: () => cached,
    });

    expect(result.components[0]?.$properties['color']).toMatchObject({ $type: 'token', '$token.kind': 'color' });
    expect(result.warnings).toEqual([expect.stringContaining('Button.color')]);
  });
});
