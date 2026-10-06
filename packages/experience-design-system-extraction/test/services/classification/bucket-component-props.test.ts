import { describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '../../../src/extract/types/component.js';
import { bucketComponentProps } from '../../../src/extract/services/classification/bucket-component-props.js';

function component(props: RawComponentDefinition['props']): RawComponentDefinition {
  return {
    name: 'Example',
    source: 'src/Example.tsx',
    framework: 'react',
    props,
    slots: [],
  };
}

describe('bucketComponentProps', () => {
  it('places every prop in exactly one deterministic bucket', () => {
    const result = bucketComponentProps(
      component([
        { name: 'className', type: 'string', required: false, domAttribute: true },
        { name: 'title', type: 'string', required: false, domAttribute: false },
        { name: 'unknown', type: '', required: false },
      ]),
    );

    expect(result).toEqual({
      component: 'Example',
      source: 'src/Example.tsx',
      customPropNames: ['title'],
      domPassthroughPropNames: ['className'],
      otherPropNames: ['unknown'],
    });

    const bucketedNames = [...result.customPropNames, ...result.domPassthroughPropNames, ...result.otherPropNames];
    expect(bucketedNames).toEqual(['title', 'className', 'unknown']);
  });

  it('does not infer DOM pass-through from a prop name', () => {
    const result = bucketComponentProps(component([{ name: 'title', type: 'string', required: false }]));

    expect(result.customPropNames).toEqual(['title']);
    expect(result.domPassthroughPropNames).toEqual([]);
  });

  it('preserves deterministic ordering independent of input order', () => {
    const result = bucketComponentProps(
      component([
        { name: 'zeta', type: 'string', required: false },
        { name: 'ariaLabel', type: 'string', required: false, domAttribute: true },
        { name: 'alpha', type: 'string', required: false },
      ]),
    );

    expect(result.customPropNames).toEqual(['alpha', 'zeta']);
    expect(result.domPassthroughPropNames).toEqual(['ariaLabel']);
  });
});
