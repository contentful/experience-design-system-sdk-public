import { describe, it, expect } from 'vitest';
import {
  requiredParentAdapter,
  normalizeToComponentName,
} from '../../../../src/analyze/composition/adapters/required-parent.js';
import type { AdapterInput } from '../../../../src/analyze/composition/adapters/types.js';

const input = (files: { path: string; content: string }[], names: string[]): AdapterInput => ({
  files,
  componentNames: new Set(names),
});

describe('required-parent adapter (T6)', () => {
  describe('normalizeToComponentName', () => {
    it('matches an exact name', () => {
      const names = new Set(['PTabs', 'PTabItem']);
      expect(normalizeToComponentName('PTabs', names)).toBe('PTabs');
    });

    it('maps a kebab tag-name to a PascalCase component name', () => {
      const names = new Set(['PTabs', 'PAccordion']);
      expect(normalizeToComponentName('p-tabs', names)).toBe('PTabs');
      expect(normalizeToComponentName('p-accordion', names)).toBe('PAccordion');
    });

    it('maps a PascalCase name to a kebab component name', () => {
      const names = new Set(['p-tabs']);
      expect(normalizeToComponentName('PTabs', names)).toBe('p-tabs');
    });

    it('returns undefined when nothing matches', () => {
      const names = new Set(['PTabs']);
      expect(normalizeToComponentName('p-unknown', names)).toBeUndefined();
    });
  });

  describe('adapter', () => {
    it('inverts a single-string requiredParent into a parent→child edge', () => {
      const files = [
        {
          path: 'p-tab-item.tsx',
          content: `
            @Component({ tag: 'p-tab-item' })
            export class PTabItem {
              requiredParent: TagName = 'p-tabs';
            }
          `,
        },
      ];
      const edges = requiredParentAdapter(input(files, ['p-tabs', 'p-tab-item']));
      expect(edges).toEqual([
        { parent: 'p-tabs', child: 'p-tab-item', provenance: 'adapter:required-parent', confidence: 5 },
      ]);
    });

    it('inverts an array requiredParent into one edge per parent', () => {
      const files = [
        {
          path: 'p-panel.tsx',
          content: `
            @Component({ tag: 'p-panel' })
            export class PPanel {
              requiredParent: TagName[] = ['p-tabs', 'p-accordion'];
            }
          `,
        },
      ];
      const edges = requiredParentAdapter(input(files, ['p-tabs', 'p-accordion', 'p-panel']));
      expect(edges).toContainEqual({
        parent: 'p-tabs',
        child: 'p-panel',
        provenance: 'adapter:required-parent',
        confidence: 5,
      });
      expect(edges).toContainEqual({
        parent: 'p-accordion',
        child: 'p-panel',
        provenance: 'adapter:required-parent',
        confidence: 5,
      });
      expect(edges).toHaveLength(2);
    });

    it('matches tag-name requiredParent against PascalCase componentNames', () => {
      const files = [
        {
          path: 'PTabItem.tsx',
          content: `
            export class PTabItem {
              requiredParent = 'p-tabs';
            }
          `,
        },
      ];
      const edges = requiredParentAdapter(input(files, ['PTabs', 'PTabItem']));
      expect(edges).toEqual([
        { parent: 'PTabs', child: 'PTabItem', provenance: 'adapter:required-parent', confidence: 5 },
      ]);
    });

    it('drops an edge when the parent is unknown', () => {
      const files = [
        {
          path: 'p-tab-item.tsx',
          content: `
            @Component({ tag: 'p-tab-item' })
            export class PTabItem {
              requiredParent = 'p-tabs';
            }
          `,
        },
      ];
      // parent p-tabs is not in componentNames
      const edges = requiredParentAdapter(input(files, ['p-tab-item']));
      expect(edges).toEqual([]);
    });

    it('drops an edge when the child is unknown', () => {
      const files = [
        {
          path: 'p-tab-item.tsx',
          content: `
            @Component({ tag: 'p-tab-item' })
            export class PTabItem {
              requiredParent = 'p-tabs';
            }
          `,
        },
      ];
      // child p-tab-item is not in componentNames
      const edges = requiredParentAdapter(input(files, ['p-tabs']));
      expect(edges).toEqual([]);
    });

    it('yields no edges for a file with no requiredParent', () => {
      const files = [
        {
          path: 'p-button.tsx',
          content: `
            @Component({ tag: 'p-button' })
            export class PButton {
              label = 'click';
            }
          `,
        },
      ];
      const edges = requiredParentAdapter(input(files, ['p-button', 'p-tabs']));
      expect(edges).toEqual([]);
    });

    it('handles multiple components across multiple files', () => {
      const files = [
        {
          path: 'p-tab-item.tsx',
          content: `
            @Component({ tag: 'p-tab-item' })
            export class PTabItem { requiredParent: TagName = 'p-tabs'; }
          `,
        },
        {
          path: 'p-accordion-item.tsx',
          content: `
            @Component({ tag: 'p-accordion-item' })
            export class PAccordionItem { requiredParent = ['p-accordion']; }
          `,
        },
      ];
      const edges = requiredParentAdapter(input(files, ['p-tabs', 'p-tab-item', 'p-accordion', 'p-accordion-item']));
      expect(edges).toContainEqual({
        parent: 'p-tabs',
        child: 'p-tab-item',
        provenance: 'adapter:required-parent',
        confidence: 5,
      });
      expect(edges).toContainEqual({
        parent: 'p-accordion',
        child: 'p-accordion-item',
        provenance: 'adapter:required-parent',
        confidence: 5,
      });
      expect(edges).toHaveLength(2);
    });

    it('infers the child from an exported const component when no decorator is present', () => {
      const files = [
        {
          path: 'TabItem.ts',
          content: `
            export const TabItem = defineComponent({
              requiredParent: 'Tabs',
            });
          `,
        },
      ];
      const edges = requiredParentAdapter(input(files, ['Tabs', 'TabItem']));
      expect(edges).toEqual([
        { parent: 'Tabs', child: 'TabItem', provenance: 'adapter:required-parent', confidence: 5 },
      ]);
    });
  });
});
