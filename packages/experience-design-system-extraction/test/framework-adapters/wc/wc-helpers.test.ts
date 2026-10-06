import { describe, expect, it } from 'vitest';
import {
  extractSlotsFromTemplate,
  mergeSlotLists,
} from '../../../src/extract/framework-adapters/web-components/helpers/extract-wc-slots.js';

describe('extractSlotsFromTemplate', () => {
  it('extracts a default slot from a bare <slot> element', () => {
    expect(extractSlotsFromTemplate('<slot></slot>')).toEqual([{ name: 'default', isDefault: true }]);
  });

  it('extracts a named slot', () => {
    expect(extractSlotsFromTemplate('<slot name="header"></slot>')).toEqual([{ name: 'header', isDefault: false }]);
  });

  it('extracts multiple distinct slots and sorts them', () => {
    const result = extractSlotsFromTemplate('<slot name="footer"></slot><slot></slot><slot name="header"></slot>');
    expect(result.map((s) => s.name)).toEqual(['default', 'footer', 'header']);
  });

  it('deduplicates slots with the same name', () => {
    const result = extractSlotsFromTemplate('<slot></slot><slot></slot>');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('default');
  });

  it('returns empty array for template with no slots', () => {
    expect(extractSlotsFromTemplate('<div>hello</div>')).toEqual([]);
  });
});

describe('mergeSlotLists', () => {
  it('merges two non-overlapping slot lists', () => {
    const a = [{ name: 'default', isDefault: true }];
    const b = [{ name: 'header', isDefault: false }];
    const result = mergeSlotLists(a, b);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toEqual(['default', 'header']);
  });

  it('prefers the first definition when names overlap', () => {
    const a = [{ name: 'default', isDefault: true, description: 'first' }];
    const b = [{ name: 'default', isDefault: true, description: 'second' }];
    const result = mergeSlotLists(a, b);
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe('first');
  });

  it('keeps description from earlier list when second has none', () => {
    const a = [{ name: 'foo', isDefault: false, description: 'from a' }];
    const b = [{ name: 'foo', isDefault: false }];
    const result = mergeSlotLists(a, b);
    expect(result[0]!.description).toBe('from a');
  });

  it('handles merging more than two lists', () => {
    const a = [{ name: 'a', isDefault: false }];
    const b = [{ name: 'b', isDefault: false }];
    const c = [{ name: 'c', isDefault: false }];
    const result = mergeSlotLists(a, b, c);
    expect(result).toHaveLength(3);
  });
});
