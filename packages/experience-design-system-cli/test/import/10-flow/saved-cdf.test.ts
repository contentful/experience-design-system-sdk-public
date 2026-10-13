import { describe, expect, it } from 'vitest';
import { buildSavedCDF } from '../../../src/tui/import/steps/10-flow/flow/save.js';

describe('wizard combined CDF output', () => {
  it('writes components and tokens into one schema-valid CDF document', () => {
    const cdf = buildSavedCDF(
      [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $description: 'A button',
            $properties: {},
          },
        },
      ],
      [{ path: 'colors.brand', $type: 'color', $value: '#09f' }],
    );

    expect(cdf.$schema).toBe('https://contentful.com/schemas/cdf');
    expect(cdf.Button).toMatchObject({ $type: 'component' });
    expect(cdf.colors).toMatchObject({
      brand: { $type: 'color', $value: '#09f' },
    });
  });
});
