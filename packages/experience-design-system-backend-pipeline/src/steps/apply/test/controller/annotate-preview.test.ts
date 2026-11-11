import { describe, expect, it } from 'vitest';
import { annotatePreview } from '../../src/controller/preview/annotate-preview.js';

const preview = {
  components: {
    unchanged: ['A'],
    changed: [
      {
        current: { name: 'B' },
        proposed: { name: 'B' },
        changeClassification: { classification: 'non-breaking' as const },
      },
      {
        current: { name: 'C' },
        proposed: { name: 'C' },
        changeClassification: { classification: 'breaking' as const },
      },
    ],
    new: [],
    removed: [{ name: 'D' }],
  },
  tokens: { unchanged: [], changed: [], new: [], removed: [] },
  taxonomies: { unchanged: [], changed: [], new: [], removed: [] },
} as never;

describe('annotatePreview', () => {
  it('maps changed → changed, breaking → breaking, removed → removed', () => {
    const result = annotatePreview({ preview, localNames: ['A', 'B', 'C', 'E'] });
    expect(result.get('A')).toBeUndefined();
    expect(result.get('B')).toBe('changed');
    expect(result.get('C')).toBe('breaking');
    expect(result.get('D')).toBe('removed');
    expect(result.get('E')).toBe('new');
  });

  it('uses resolved IDs for unchanged, changed, breaking and removed source components', () => {
    const response = {
      tokens: { unchanged: [], changed: [], new: [], removed: [] },
      taxonomies: { unchanged: [], changed: [], new: [], removed: [] },
      components: {
        unchanged: ['card'],
        changed: [
          { current: { id: 'panel', name: 'Panel Display' }, changeClassification: { classification: 'compatible' } },
          { current: { id: 'button', name: 'Button Display' }, changeClassification: { classification: 'breaking' } },
        ],
        removed: [{ id: 'section', name: 'Section Display' }],
        new: [],
      },
    } as never;
    const result = annotatePreview({
      preview: response,
      localNames: ['Card', 'Panel', 'Button', 'Section', 'Badge'],
      componentIds: new Map([
        ['Card', 'card'],
        ['Panel', 'panel'],
        ['Button', 'button'],
        ['Section', 'section'],
        ['Badge', 'Badge'],
      ]),
    });

    expect(result.get('Card')).toBeUndefined();
    expect(result.get('Panel')).toBe('changed');
    expect(result.get('Button')).toBe('breaking');
    expect(result.get('Section')).toBe('removed');
    expect(result.get('Badge')).toBe('new');
    expect(result.has('Panel Display')).toBe(false);
  });
});
