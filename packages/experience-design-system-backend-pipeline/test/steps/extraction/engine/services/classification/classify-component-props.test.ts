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

describe('type-based DOM prop classification', () => {
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
    expect(preClassifyProp(prop({ name }))).toEqual({ category: 'content', cdfTypeHint: 'string' });
    expect(preClassifyComponent(component([prop({ name })])).props).toEqual([
      expect.objectContaining({ name, type: 'string', category: 'content' }),
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
          category: 'content',
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

  it('uses primitive and literal types while preserving existing categories', () => {
    expect(preClassifyProp(prop({ name: 'hidden', type: 'boolean' }))).toEqual({
      category: 'design',
      cdfTypeHint: 'boolean',
    });
    expect(preClassifyProp(prop({ name: 'tabIndex', type: 'number' }))).toEqual({
      category: 'design',
      cdfTypeHint: 'string',
    });
    expect(preClassifyProp(prop({ name: 'role', type: "'alert' | 'status'" }))).toEqual({
      category: 'design',
      cdfTypeHint: 'enum',
    });
    expect(preClassifyComponent(component([prop({ name: 'className', category: 'design' })])).props).toEqual([
      expect.objectContaining({ name: 'className', category: 'design' }),
    ]);
  });

  it.each([
    ['onClick', '() => void'],
    ['ref', 'Ref<HTMLElement>'],
    ['key', 'string'],
    ['data-testid', 'string'],
    ['testId', 'string'],
    ['dataTestId', 'string'],
    ['setValue', 'Dispatch<string>'],
  ])('continues to exclude explicit wiring prop %s even when preclassified', (name, type) => {
    const input = prop({ name, type, category: 'content' });
    expect(preClassifyProp(input)).toEqual({ category: 'exclude' });
    expect(preClassifyComponent(component([input])).props).toEqual([]);
  });
});
