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
});
