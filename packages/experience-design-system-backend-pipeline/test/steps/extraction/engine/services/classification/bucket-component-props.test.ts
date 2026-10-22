import { describe, expect, it } from 'vitest';
import * as extraction from '../../../../../../src/steps/extraction/index.js';
import type { RawComponentDefinition } from '../../../../../../src/steps/extraction/src/types/component.js';

function component(
  props: RawComponentDefinition['props'],
  name = 'Example',
  source = 'src/Example.tsx',
): RawComponentDefinition {
  return { name, source, framework: 'react', props, slots: [] };
}

describe('deterministic advisory prop buckets', () => {
  it('assigns every prop once using type availability and DOM evidence', () => {
    expect(typeof extraction.bucketComponentProps).toBe('function');
    const input = component([
      { name: 'className', type: 'string', required: false, domAttribute: true },
      { name: 'title', type: 'string', required: false, domAttribute: false },
      { name: 'unknown', type: '  ', required: false, domAttribute: true },
      { name: 'modelValue', type: 'string', required: false },
    ]);
    const before = structuredClone(input);

    expect(extraction.bucketComponentProps(input)).toEqual({
      component: 'Example',
      source: 'src/Example.tsx',
      customPropNames: ['modelValue', 'title'],
      domPassthroughPropNames: ['className'],
      otherPropNames: ['unknown'],
    });
    expect(input).toEqual(before);
  });

  it('does not infer DOM forwarding from prop names or categories', () => {
    expect(typeof extraction.bucketComponentProps).toBe('function');
    expect(
      extraction.bucketComponentProps(
        component([
          { name: 'className', type: 'string', required: false, category: 'design' },
          { name: 'ariaLabel', type: 'string', required: false },
        ]),
      ),
    ).toMatchObject({ customPropNames: ['ariaLabel', 'className'], domPassthroughPropNames: [], otherPropNames: [] });
  });

  it('sorts both component identities and prop names without changing input order', () => {
    expect(typeof extraction.bucketComponentsProps).toBe('function');
    const inputs = [
      component([], 'Zeta'),
      component(
        [
          { name: 'zeta', type: 'string', required: false },
          { name: 'alpha', type: 'string', required: false },
        ],
        'Alpha',
        'src/Z.tsx',
      ),
      component([], 'Alpha', 'src/A.tsx'),
    ];
    const before = structuredClone(inputs);
    const result = extraction.bucketComponentsProps(inputs);

    expect(result.map(({ component, source }) => [component, source])).toEqual([
      ['Alpha', 'src/A.tsx'],
      ['Alpha', 'src/Z.tsx'],
      ['Zeta', 'src/Example.tsx'],
    ]);
    expect(result[1]?.customPropNames).toEqual(['alpha', 'zeta']);
    expect(inputs).toEqual(before);
    expect(extraction.bucketComponentsProps([])).toEqual([]);
  });
});
