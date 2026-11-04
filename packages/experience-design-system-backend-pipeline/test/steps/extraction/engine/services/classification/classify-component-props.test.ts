import { describe, expect, it } from 'vitest';
import { preClassifyComponent, preClassifyProp } from '../../../../../../src/steps/extraction/index.js';
import type {
  RawComponentDefinition,
  RawPropDefinition,
} from '../../../../../../src/steps/extraction/src/types/component.js';

function prop(overrides: Partial<RawPropDefinition>): RawPropDefinition {
  return { name: 'label', type: 'string', required: false, ...overrides };
}

function component(props: RawPropDefinition[], framework: RawComponentDefinition['framework'] = 'react') {
  return { name: 'Field', source: '/project/Field.tsx', framework, props, slots: [] };
}

describe('source-preserving category handoff', () => {
  it.each([
    ['onReady', 'string'],
    ['ref', 'string'],
    ['key', 'string'],
    ['testId', 'string'],
    ['callback', '() => void'],
    ['arbitrary', 'Dispatch<string>'],
    ['arbitrary', 'RefObject<string>'],
    ['variant', 'string'],
    ['disabled', 'boolean'],
    ['componentId', 'string'],
    ['size', 'number'],
    ['arbitrary', 'number'],
    ['arbitrary', 'boolean'],
    ['arbitrary', "'first' | 'second'"],
  ])('retains %s %s without guessing a semantic category', (name, type) => {
    const input = component([prop({ name, type })]);
    const before = JSON.stringify(input);
    expect(preClassifyProp(input.props[0]!)).toBeUndefined();
    expect(preClassifyComponent(input).props).toEqual(input.props);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    'className',
    'class',
    'id',
    'role',
    'htmlFor',
    'slot',
    'lang',
    'dir',
    'aria-label',
    'ariaLabel',
    'data-tracking-id',
    'dataQa',
    'data-qa',
    'as',
    'element',
    'modelValue',
  ])('retains the string prop %s regardless of its name', (name) => {
    expect(preClassifyProp(prop({ name }))).toBeUndefined();
    expect(preClassifyComponent(component([prop({ name })])).props).toEqual([
      expect.objectContaining({ name, type: 'string' }),
    ]);
  });

  it.each(['react', 'next', 'vue', 'astro', 'stencil', 'web-component', 'svelte'] as const)(
    'retains DOM-forwarded name props for %s without mutating the extraction input',
    (framework) => {
      const name = prop({ name: 'name', domAttribute: true, description: 'Form field name', defaultValue: 'contact' });
      const input = component([name], framework);

      expect(preClassifyComponent(input).props).toEqual([
        {
          name: 'name',
          type: 'string',
          required: false,
          description: 'Form field name',
          defaultValue: 'contact',
          domAttribute: true,
        },
      ]);
      expect(input.props[0]).toBe(name);
      expect(name.domAttribute).toBe(true);
      expect(name.category).toBeUndefined();
    },
  );

  it.each([true, false, undefined])(
    'preserves provenance %s for unclassified and preclassified props',
    (domAttribute) => {
      const props = [
        prop({ name: 'payload', type: 'Payload', ...(domAttribute === undefined ? {} : { domAttribute }) }),
        prop({ name: 'label', category: 'design', ...(domAttribute === undefined ? {} : { domAttribute }) }),
      ];
      expect(preClassifyComponent(component(props)).props).toEqual(props);
    },
  );

  it.each([
    ['styles', 'object'],
    ['classes', 'Record<string, string>'],
    ['sx', 'SxProps'],
    ['modelModifiers', 'object'],
  ])('retains the complex prop %s for downstream reasoning', (name, type) => {
    const input = prop({ name, type });
    expect(preClassifyProp(input)).toBeUndefined();
    expect(preClassifyComponent(component([input])).props).toEqual([input]);
  });

  it('preserves primitive and literal type evidence without settling categories', () => {
    for (const input of [
      prop({ name: 'hidden', type: 'boolean' }),
      prop({ name: 'tabIndex', type: 'number' }),
      prop({ name: 'role', type: "'alert' | 'status'" }),
    ]) {
      expect(preClassifyProp(input)).toBeUndefined();
      expect(preClassifyComponent(component([input])).props).toEqual([input]);
    }
    const decided = prop({ name: 'className', category: 'design' });
    expect(preClassifyProp(decided)).toEqual({ category: 'design' });
    expect(preClassifyComponent(component([decided])).props).toEqual([decided]);
  });

  it.each([
    ['onClick', '() => void'],
    ['ref', 'Ref<HTMLElement>'],
    ['key', 'string'],
    ['data-testid', 'string'],
    ['testId', 'string'],
    ['dataTestId', 'string'],
    ['setValue', 'Dispatch<string>'],
  ])('preserves explicit decisions and source input %s regardless of spelling', (name, type) => {
    const input = prop({ name, type, category: 'content' });
    expect(preClassifyProp(input)).toEqual({ category: 'content' });
    expect(preClassifyComponent(component([input])).props).toEqual([input]);
  });
});
