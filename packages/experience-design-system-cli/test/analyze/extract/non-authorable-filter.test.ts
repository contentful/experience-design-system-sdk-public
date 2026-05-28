import { describe, it, expect } from 'vitest';
import { isNonAuthorableComponent } from '../../../src/analyze/extract/non-authorable-filter.js';
import type { RawComponentDefinition } from '../../../src/types.js';

function makeComponent(partial: Partial<RawComponentDefinition>): RawComponentDefinition {
  return {
    name: 'Sample',
    source: '/sample.tsx',
    framework: 'react',
    props: [],
    slots: [{ name: 'default', isDefault: true }],
    ...partial,
  };
}

describe('isNonAuthorableComponent', () => {
  describe('Rule A: name pattern', () => {
    it('flags components whose name ends with Provider', () => {
      const result = isNonAuthorableComponent(
        makeComponent({ name: 'AbmProvider', usesCreateContext: true }),
      );
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/provider/i);
    });

    it('flags components whose name ends with Context', () => {
      const result = isNonAuthorableComponent(
        makeComponent({ name: 'ThemeContext', usesCreateContext: true }),
      );
      expect(result.skip).toBe(true);
    });

    it('does NOT flag Provider-named components without createContext usage', () => {
      // e.g. a visual "FeatureProvider" that just composes UI; conservative — keep it
      const result = isNonAuthorableComponent(
        makeComponent({ name: 'FeatureProvider', usesCreateContext: false }),
      );
      expect(result.skip).toBe(false);
    });
  });

  describe('Rule B: createContext source signal', () => {
    it('flags components from files using createContext when prop signature matches Context.Provider', () => {
      // Use a name that does NOT end in Provider/Context so Rule A doesn't fire,
      // forcing the predicate down to Rule B.
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'AbmShell',
          usesCreateContext: true,
          props: [{ name: 'value', type: 'AbmAccount | null', required: true }],
        }),
      );
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/value prop/i);
    });
  });

  describe('Rule C: no authorable props', () => {
    it('flags components where every prop is unclassified after pre-classify', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'Analytics',
          props: [
            { name: 'config', type: 'AnalyticsConfig', required: true },
            { name: 'tracker', type: 'Tracker', required: false },
          ],
        }),
      );
      expect(result.skip).toBe(true);
      expect(result.reason).toMatch(/no authorable props/i);
    });

    it('does NOT flag components with at least one classified prop', () => {
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'Accordion',
          props: [
            { name: 'title', type: 'string', required: true, category: 'content' },
            { name: 'config', type: 'AnalyticsConfig', required: false },
          ],
        }),
      );
      expect(result.skip).toBe(false);
    });

    it('treats components with only a children slot and no props as authorable layout wrappers', () => {
      // empty props, default slot only — could be a layout component, keep it
      const result = isNonAuthorableComponent(
        makeComponent({ name: 'Stack', props: [] }),
      );
      expect(result.skip).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('Control: ordinary visual components', () => {
    it('does NOT flag a normal component', () => {
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

    it('handles components with no usesCreateContext flag set (treats as falsy)', () => {
      // Optional flag may be undefined when extractor didn't see createContext;
      // predicate should treat that as Rule A/B falsy without throwing.
      const result = isNonAuthorableComponent(
        makeComponent({
          name: 'AbmProvider',
          usesCreateContext: undefined,
          props: [
            { name: 'title', type: 'string', required: true, category: 'content' },
          ],
        }),
      );
      expect(result.skip).toBe(false);
    });
  });
});
