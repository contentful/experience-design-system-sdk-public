import { describe, it, expect } from 'vitest';
import { validateExtractedComponents } from '../../../src/analyze/extract/validate.js';
import type { RawComponentDefinition } from '../../../src/types.js';

describe('validateExtractedComponents integration', () => {
  it('attaches empty validationIssues to valid components without mutating originals', () => {
    const original: RawComponentDefinition = {
      name: 'Button',
      source: '/src/Button.tsx',
      framework: 'react',
      props: [{ name: 'variant', type: 'string', required: false }],
      slots: [],
    };

    const result = validateExtractedComponents([original]);

    expect(result[0]).not.toBe(original);
    expect(result[0].validationIssues).toEqual([]);
    expect(original.validationIssues).toBeUndefined();
  });

  it('components with errors have severity "error" issues', () => {
    const components: RawComponentDefinition[] = [
      {
        name: '',
        source: '/src/Bad.tsx',
        framework: 'react',
        props: [],
        slots: [{ name: '', isDefault: false }],
      },
    ];
    const result = validateExtractedComponents(components);
    const errors = (result[0].validationIssues ?? []).filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns all components — never removes them', () => {
    const components: RawComponentDefinition[] = [
      { name: '', source: '/src/A.tsx', framework: 'react', props: [], slots: [] },
      { name: 'B', source: '/src/B.tsx', framework: 'react', props: [], slots: [] },
    ];
    const result = validateExtractedComponents(components);
    expect(result).toHaveLength(2);
  });
});
