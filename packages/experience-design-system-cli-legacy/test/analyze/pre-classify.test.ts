import { describe, it, expect } from 'vitest';

import { preClassifyProp, preClassifyComponent } from '@contentful/experience-design-system-extraction';
import type { RawPropDefinition, RawComponentDefinition } from '../../src/types.js';

function makeProp(partial: Partial<RawPropDefinition> & Pick<RawPropDefinition, 'name' | 'type'>): RawPropDefinition {
  return { required: false, ...partial };
}

describe('preClassifyProp', () => {
  describe('Rule 1: Event handlers', () => {
    it('excludes props starting with on + uppercase', () => {
      expect(preClassifyProp(makeProp({ name: 'onClick', type: '() => void' }))).toEqual({
        category: 'exclude',
      });
    });

    it('excludes onMouseDown with EventHandler type', () => {
      expect(preClassifyProp(makeProp({ name: 'onMouseDown', type: 'React.MouseEventHandler' }))).toEqual({
        category: 'exclude',
      });
    });

    it('does NOT exclude functions that do not return void', () => {
      expect(preClassifyProp(makeProp({ name: 'transform', type: '(value: string) => string' }))).toBeUndefined();
    });
  });

  describe('Rule 2: Refs', () => {
    it('excludes ref prop', () => {
      expect(preClassifyProp(makeProp({ name: 'ref', type: 'React.Ref<HTMLDivElement>' }))).toEqual({
        category: 'exclude',
      });
    });

    it('excludes innerRef prop', () => {
      expect(preClassifyProp(makeProp({ name: 'innerRef', type: 'RefObject<HTMLElement>' }))).toEqual({
        category: 'exclude',
      });
    });
  });

  describe('Rule 3: Test IDs', () => {
    it('excludes testId', () => {
      expect(preClassifyProp(makeProp({ name: 'testId', type: 'string' }))).toEqual({
        category: 'exclude',
      });
    });

    it('excludes data-testid', () => {
      expect(preClassifyProp(makeProp({ name: 'data-testid', type: 'string' }))).toEqual({
        category: 'exclude',
      });
    });
  });

  describe('Rule 4: Key prop', () => {
    it('excludes key', () => {
      expect(preClassifyProp(makeProp({ name: 'key', type: 'string' }))).toEqual({
        category: 'exclude',
      });
    });
  });

  describe('Rule 5: Dispatch/setter', () => {
    it('excludes Dispatch types', () => {
      expect(preClassifyProp(makeProp({ name: 'setCount', type: 'React.Dispatch<SetStateAction<number>>' }))).toEqual({
        category: 'exclude',
      });
    });
  });

  describe('Rule 7: String literal union', () => {
    it('classifies quoted unions as design enum', () => {
      expect(preClassifyProp(makeProp({ name: 'variant', type: "'primary' | 'secondary'" }))).toEqual({
        category: 'design',
        cdfTypeHint: 'enum',
      });
    });
  });

  describe('Rule 8: Design name patterns', () => {
    it('classifies bgColor as design', () => {
      expect(preClassifyProp(makeProp({ name: 'bgColor', type: 'string' }))).toEqual({
        category: 'design',
        cdfTypeHint: 'string',
      });
    });

    it('classifies size as design', () => {
      expect(preClassifyProp(makeProp({ name: 'size', type: 'string' }))).toEqual({
        category: 'design',
        cdfTypeHint: 'string',
      });
    });

    it('classifies backgroundColor (ends with Color) as design', () => {
      expect(preClassifyProp(makeProp({ name: 'backgroundColor', type: 'string' }))).toEqual({
        category: 'design',
        cdfTypeHint: 'string',
      });
    });

    it('does NOT apply rule 8 to complex types', () => {
      expect(preClassifyProp(makeProp({ name: 'variant', type: '{ x: string }' }))).toBeUndefined();
    });
  });

  describe('Rule 9: Boolean + visual toggle', () => {
    it('classifies hideChevron boolean as design with boolean hint', () => {
      expect(preClassifyProp(makeProp({ name: 'hideChevron', type: 'boolean' }))).toEqual({
        category: 'design',
        cdfTypeHint: 'boolean',
      });
    });

    it('classifies verticalTop boolean as design with boolean hint', () => {
      expect(preClassifyProp(makeProp({ name: 'verticalTop', type: 'boolean' }))).toEqual({
        category: 'design',
        cdfTypeHint: 'boolean',
      });
    });
  });

  describe('Rule 10: Boolean + state names', () => {
    it('classifies disabled boolean as state with boolean hint', () => {
      expect(preClassifyProp(makeProp({ name: 'disabled', type: 'boolean' }))).toEqual({
        category: 'state',
        cdfTypeHint: 'boolean',
      });
    });

    it('classifies loading boolean as state with boolean hint', () => {
      expect(preClassifyProp(makeProp({ name: 'loading', type: 'boolean' }))).toEqual({
        category: 'state',
        cdfTypeHint: 'boolean',
      });
    });

    it('classifies isOpen boolean as state with boolean hint', () => {
      expect(preClassifyProp(makeProp({ name: 'isOpen', type: 'boolean' }))).toEqual({
        category: 'state',
        cdfTypeHint: 'boolean',
      });
    });
  });

  describe('Rule 11: State identifiers', () => {
    it('classifies componentId as state', () => {
      expect(preClassifyProp(makeProp({ name: 'componentId', type: 'string' }))).toEqual({
        category: 'state',
        cdfTypeHint: 'string',
      });
    });

    it('classifies sectionKey as state', () => {
      expect(preClassifyProp(makeProp({ name: 'sectionKey', type: 'string' }))).toEqual({
        category: 'state',
        cdfTypeHint: 'string',
      });
    });
  });

  describe('Rule 12: URL patterns', () => {
    it('classifies href as content', () => {
      expect(preClassifyProp(makeProp({ name: 'href', type: 'string' }))).toEqual({
        category: 'content',
        cdfTypeHint: 'string',
      });
    });

    it('classifies linkUrl (ends with Url) as content', () => {
      expect(preClassifyProp(makeProp({ name: 'linkUrl', type: 'string' }))).toEqual({
        category: 'content',
        cdfTypeHint: 'string',
      });
    });
  });

  describe('Rule 13: Text patterns', () => {
    it('classifies labelText as content', () => {
      expect(preClassifyProp(makeProp({ name: 'labelText', type: 'string' }))).toEqual({
        category: 'content',
        cdfTypeHint: 'string',
      });
    });

    it('classifies title as content', () => {
      expect(preClassifyProp(makeProp({ name: 'title', type: 'string' }))).toEqual({
        category: 'content',
        cdfTypeHint: 'string',
      });
    });

    it('classifies boldText (ends with Text) as content', () => {
      expect(preClassifyProp(makeProp({ name: 'boldText', type: 'string' }))).toEqual({
        category: 'content',
        cdfTypeHint: 'string',
      });
    });
  });

  describe('Rule 14: Remaining strings', () => {
    it('classifies generic string prop as content', () => {
      expect(preClassifyProp(makeProp({ name: 'something', type: 'string' }))).toEqual({
        category: 'content',
        cdfTypeHint: 'string',
      });
    });
  });

  describe('Rule 15: Remaining booleans', () => {
    it('classifies generic boolean prop as design with boolean hint', () => {
      expect(preClassifyProp(makeProp({ name: 'rounded', type: 'boolean' }))).toEqual({
        category: 'design',
        cdfTypeHint: 'boolean',
      });
    });
  });

  describe('boolean cdfTypeHint never falls back to string', () => {
    // CDF supports native boolean as a cdf_type since PR #76. The pre-classify
    // hint must not bias the LLM toward 'string' for boolean-typed props.
    const booleanCases = [
      // Visual-toggle names (Rule 9)
      'hideChevron',
      'showLabel',
      'enableEffect',
      'disableAutoplay',
      'verticalAlignment',
      'horizontalLayout',
      'reverseOrder',
      'boldText',
      'italicText',
      'imageOnLeft',
      'withBorder',
      // State names (Rule 10)
      'disabled',
      'loading',
      'expanded',
      'isOpen',
      'selected',
      'checked',
      'active',
      'preview',
      // Remaining booleans (Rule 15)
      'rounded',
      'flat',
      'someArbitraryFlag',
    ];

    it.each(booleanCases)('classifies "%s: boolean" with cdfTypeHint of "boolean" (never "string")', (name) => {
      const result = preClassifyProp(makeProp({ name, type: 'boolean' }));
      expect(result?.cdfTypeHint).toBe('boolean');
      expect(result?.cdfTypeHint).not.toBe('string');
    });
  });

  describe('Rule 16: Remaining numbers', () => {
    it('classifies number prop as design', () => {
      expect(preClassifyProp(makeProp({ name: 'columns', type: 'number' }))).toEqual({
        category: 'design',
        cdfTypeHint: 'string',
      });
    });
  });

  describe('Rule 17: Complex types', () => {
    it('returns undefined for object types', () => {
      expect(preClassifyProp(makeProp({ name: 'item', type: '{ url: string; alt: string }' }))).toBeUndefined();
    });

    it('returns undefined for non-void function types', () => {
      expect(preClassifyProp(makeProp({ name: 'transform', type: '(value: string) => string' }))).toBeUndefined();
    });

    it('returns undefined for array types', () => {
      expect(preClassifyProp(makeProp({ name: 'items', type: 'TabItem[]' }))).toBeUndefined();
    });
  });
});

describe('preClassifyComponent', () => {
  const baseComponent: RawComponentDefinition = {
    name: 'TestComponent',
    source: 'test.tsx',
    framework: 'react',
    props: [],
    slots: [],
  };

  it('assigns category to props that match rules (except exclude)', () => {
    const component: RawComponentDefinition = {
      ...baseComponent,
      props: [
        makeProp({ name: 'title', type: 'string' }),
        makeProp({ name: 'size', type: 'string' }),
        makeProp({ name: 'disabled', type: 'boolean' }),
      ],
    };

    const result = preClassifyComponent(component);
    expect(result.props[0].category).toBe('content');
    expect(result.props[1].category).toBe('design');
    expect(result.props[2].category).toBe('state');
  });

  it('does NOT overwrite existing category values', () => {
    const component: RawComponentDefinition = {
      ...baseComponent,
      props: [makeProp({ name: 'title', type: 'string', category: 'design' })],
    };

    const result = preClassifyComponent(component);
    expect(result.props[0].category).toBe('design');
  });

  it('removes excluded props from the classification payload', () => {
    const component: RawComponentDefinition = {
      ...baseComponent,
      props: [
        makeProp({ name: 'onClick', type: '() => void' }),
        makeProp({ name: 'ref', type: 'React.Ref<HTMLDivElement>' }),
        makeProp({ name: 'testId', type: 'string' }),
      ],
    };

    const result = preClassifyComponent(component);
    expect(result.props).toEqual([]);
  });

  it('classifies DOM and a11y props by their type instead of excluding them by name', () => {
    const component: RawComponentDefinition = {
      ...baseComponent,
      props: [
        makeProp({ name: 'className', type: 'string' }),
        makeProp({ name: 'aria-label', type: 'string' }),
        makeProp({ name: 'data-testid', type: 'string' }),
        makeProp({ name: 'sx', type: 'SxProps' }),
        makeProp({ name: 'label', type: 'string' }),
        makeProp({ name: 'name', type: 'string' }),
        makeProp({ name: 'variant', type: "'primary' | 'secondary'" }),
      ],
    };

    const result = preClassifyComponent(component);

    expect(result.props).toEqual([
      expect.objectContaining({ name: 'className', category: 'content' }),
      expect.objectContaining({ name: 'aria-label', category: 'content' }),
      expect.objectContaining({ name: 'sx' }),
      expect.objectContaining({ name: 'label', category: 'content' }),
      expect.objectContaining({ name: 'name', category: 'content' }),
      expect.objectContaining({ name: 'variant', category: 'design' }),
    ]);
  });

  it.each(['react', 'vue', 'stencil', 'web-component'] as const)(
    'does not pre-classify DOM provenance by prop name for %s',
    (framework) => {
      const formControl: RawComponentDefinition = {
        ...baseComponent,
        name: 'FormControl',
        framework,
        props: [
          makeProp({ name: 'name', type: 'string', domAttribute: true }),
          makeProp({ name: 'label', type: 'string' }),
        ],
      };
      const semanticSelector: RawComponentDefinition = {
        ...baseComponent,
        name: 'VisibleAsset',
        framework,
        props: [makeProp({ name: 'name', type: 'string' })],
      };

      expect(preClassifyComponent(formControl).props.map((prop) => prop.name)).toEqual(['name', 'label']);
      expect(preClassifyComponent(semanticSelector).props).toEqual([
        expect.objectContaining({ name: 'name', category: 'content' }),
      ]);
    },
  );

  it.each(['PFlag', 'Icon', 'Animation'])('retains the semantic name selector on %s', (name) => {
    const component: RawComponentDefinition = {
      ...baseComponent,
      name,
      props: [makeProp({ name: 'name', type: 'string' })],
    };

    expect(preClassifyComponent(component).props).toEqual([
      expect.objectContaining({ name: 'name', category: 'content' }),
    ]);
  });

  it('removes only explicitly excluded props even if they were pre-categorized', () => {
    const component: RawComponentDefinition = {
      ...baseComponent,
      props: [
        makeProp({ name: 'className', type: 'string', category: 'design' }),
        makeProp({ name: 'aria-label', type: 'string', category: 'content' }),
        makeProp({ name: 'data-testid', type: 'string', category: 'state' }),
        makeProp({ name: 'sx', type: 'SxProps', category: 'design' }),
        makeProp({ name: 'label', type: 'string', category: 'content' }),
      ],
    };

    expect(preClassifyComponent(component).props).toEqual([
      expect.objectContaining({ name: 'className', category: 'design' }),
      expect.objectContaining({ name: 'aria-label', category: 'content' }),
      expect.objectContaining({ name: 'sx', category: 'design' }),
      expect.objectContaining({ name: 'label', category: 'content' }),
    ]);
  });

  it('does not expose extraction provenance in the downstream classification payload', () => {
    const component: RawComponentDefinition = {
      ...baseComponent,
      props: [makeProp({ name: 'href', type: 'string', domAttribute: true })],
    };

    const result = preClassifyComponent(component);

    expect(result.props[0]).not.toHaveProperty('domAttribute');
    expect(result.props).toEqual([expect.objectContaining({ name: 'href', category: 'content' })]);
  });

  it('returns undefined category for complex types', () => {
    const component: RawComponentDefinition = {
      ...baseComponent,
      props: [makeProp({ name: 'items', type: 'TabItem[]' }), makeProp({ name: 'config', type: '{ x: number }' })],
    };

    const result = preClassifyComponent(component);
    expect(result.props[0].category).toBeUndefined();
    expect(result.props[1].category).toBeUndefined();
  });
});
