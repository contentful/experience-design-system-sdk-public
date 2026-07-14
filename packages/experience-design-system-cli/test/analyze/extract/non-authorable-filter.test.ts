import { describe, it, expect } from 'vitest';
import { isNonAuthorableComponent } from '../../../src/analyze/extract/non-authorable-filter.js';
import type { RawComponentDefinition } from '../../../src/types.js';

function makeComponent(partial: Partial<RawComponentDefinition>): RawComponentDefinition {
  return {
    name: 'Sample',
    source: '/sample.tsx',
    framework: 'react',
    props: [],
    slots: [{ name: 'children', isDefault: true }],
    ...partial,
  };
}

describe('isNonAuthorableComponent', () => {
  describe('R1: zero props and zero slots', () => {
    it('flags components with no props and no slots', () => {
      const result = isNonAuthorableComponent(makeComponent({ name: 'GtmHeadScript', props: [], slots: [] }));
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/no props and no slots/i);
    });

    it('does NOT flag a layout component with zero props but a children slot', () => {
      const result = isNonAuthorableComponent(
        makeComponent({ name: 'Stack', props: [], slots: [{ name: 'children', isDefault: true }] }),
      );
      expect(result.skip).toBe(false);
    });
  });

  describe('R2: createContext + value prop', () => {
    it('flags components with a literal value prop in a createContext source', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'AbmProvider',
          usesCreateContext: true,
          props: [{ name: 'value', type: 'AbmAccount | null', required: true }],
        }),
      );
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/value prop/i);
    });

    it('does NOT flag a value prop when source does not use createContext', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'Slider',
          usesCreateContext: false,
          props: [{ name: 'value', type: 'number', required: true, category: 'state' }],
        }),
      );
      expect(result.skip).toBe(false);
    });
  });

  describe('R3: createContext + zero props', () => {
    it('flags zero-prop components in a createContext source', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'FontProvider',
          usesCreateContext: true,
          props: [],
          slots: [{ name: 'children', isDefault: true }],
        }),
      );
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/no props/i);
    });

    it('does NOT flag zero-prop components when source does not use createContext', () => {
      const result = isNonAuthorableComponent(
        makeComponent({ name: 'Container', usesCreateContext: false, props: [] }),
      );
      expect(result.skip).toBe(false);
    });
  });

  describe('R4: createContext + single non-handler prop', () => {
    it('flags createContext components with one named-type data prop', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'LocaleProvider',
          usesCreateContext: true,
          props: [{ name: 'locale', type: 'Locale', required: true, category: 'state' }],
        }),
      );
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/single non-handler prop/i);
    });

    it('flags createContext components with one array data prop', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'NavigationProvider',
          usesCreateContext: true,
          props: [{ name: 'navItems', type: 'INavItemProps[]', required: true }],
        }),
      );
      expect(result.skip).toBe(true);
    });

    it('does NOT flag createContext components when the single prop is a handler', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'CounterSetterProvider',
          usesCreateContext: true,
          props: [{ name: 'setCount', type: 'Dispatch<SetStateAction<number>>', required: true }],
        }),
      );
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/handler or ref/i);
    });

    it('does NOT flag a single-prop content component without createContext', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'RichTextComponent',
          usesCreateContext: false,
          props: [{ name: 'richTextData', type: 'Document', required: true }],
        }),
      );
      expect(result.skip).toBe(false);
    });

    it('does NOT fire R4 when there are 2+ props (lets R5 or keep handle it)', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'TwoPropProvider',
          usesCreateContext: true,
          props: [
            { name: 'locale', type: 'Locale', required: true },
            { name: 'theme', type: 'Theme', required: true },
          ],
        }),
      );
      expect(result.skip).toBe(false);
    });
  });

  describe('R5: every prop is a handler or ref', () => {
    it('flags components where every prop is a function-typed handler', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'OsanoCookiePlaceholder',
          props: [{ name: 'onBannerLoaded', type: '() => void', required: true }],
        }),
      );
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/handler or ref/i);
    });

    it('flags components with mixed handler + setter + ref props', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'FeedbackCard',
          props: [
            { name: 'setShowModal', type: '(show: boolean) => void', required: true },
            { name: 'innerRef', type: 'RefObject<HTMLDivElement>', required: false },
          ],
        }),
      );
      expect(result.skip).toBe(true);
    });

    it('does NOT flag components with at least one non-handler prop', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'NavigationPanelMobile',
          props: [
            { name: 'handleClose', type: '() => void', required: true },
            { name: 'isOpen', type: 'boolean', required: true, category: 'state' },
            { name: 'navItems', type: 'INavItemProps[]', required: true },
          ],
        }),
      );
      expect(result.skip).toBe(false);
    });
  });

  describe('Control: ordinary authoring components are kept', () => {
    it('keeps a component with content/design/state props', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'Accordion',
          props: [
            { name: 'title', type: 'string', required: true, category: 'content' },
            { name: 'expanded', type: 'boolean', required: false, category: 'state' },
          ],
        }),
      );
      expect(result.skip).toBe(false);
    });

    it('keeps a CMS-driven wrapper with any-typed content props', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'BasicCardWrapper',
          props: [
            { name: 'title', type: 'any', required: true },
            { name: 'description', type: 'any', required: true },
            { name: 'linkUrl', type: 'any', required: true },
          ],
        }),
      );
      expect(result.skip).toBe(false);
    });

    it('handles undefined usesCreateContext as falsy without throwing', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'AbmProvider',
          usesCreateContext: undefined,
          props: [{ name: 'title', type: 'string', required: true, category: 'content' }],
        }),
      );
      expect(result.skip).toBe(false);
    });
  });
});
