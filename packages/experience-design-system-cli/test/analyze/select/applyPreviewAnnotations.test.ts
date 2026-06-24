import { describe, expect, it } from 'vitest';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { applyPreviewAnnotations } from '../../../src/analyze/select/preview-annotations.js';

function makePreview(overrides: Partial<ServerPreviewResponse['components']>): ServerPreviewResponse {
  return {
    components: {
      new: [],
      changed: [],
      removed: [],
      unchanged: [],
      ...overrides,
    },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  } as unknown as ServerPreviewResponse;
}

describe('applyPreviewAnnotations', () => {
  it('marks every local name "new" when nothing is unchanged/changed/removed', () => {
    const preview = makePreview({});
    const map = applyPreviewAnnotations(preview, ['Btn', 'Card', 'Image']);
    expect(map.get('Btn')).toBe('new');
    expect(map.get('Card')).toBe('new');
    expect(map.get('Image')).toBe('new');
  });

  it('omits unchanged local names from "new"', () => {
    const preview = makePreview({ unchanged: ['Btn'] });
    const map = applyPreviewAnnotations(preview, ['Btn', 'Card']);
    expect(map.has('Btn')).toBe(false);
    expect(map.get('Card')).toBe('new');
  });

  it('marks removed components as "removed"', () => {
    const preview = makePreview({
      removed: [
        {
          id: 'c1',
          name: 'GoneBtn',
          contentProperties: [],
          designProperties: [],
          slots: [],
        },
      ],
    });
    const map = applyPreviewAnnotations(preview, []);
    expect(map.get('GoneBtn')).toBe('removed');
  });

  it('marks compatible-changed as "changed" and excludes that name from "new"', () => {
    const preview = makePreview({
      changed: [
        {
          current: { id: 'c1', name: 'Btn', contentProperties: [], designProperties: [], slots: [] },
          proposed: { $type: 'component', $properties: {} } as never,
          hasPendingDraftChanges: false,
          changeClassification: { classification: 'compatible', breakingChanges: [] },
        },
      ],
    });
    const map = applyPreviewAnnotations(preview, ['Btn', 'Card']);
    expect(map.get('Btn')).toBe('changed');
    expect(map.get('Card')).toBe('new');
  });

  it('marks breaking-classified changed as "breaking" (precedence)', () => {
    const preview = makePreview({
      changed: [
        {
          current: { id: 'c1', name: 'Btn', contentProperties: [], designProperties: [], slots: [] },
          proposed: { $type: 'component', $properties: {} } as never,
          hasPendingDraftChanges: false,
          changeClassification: {
            classification: 'breaking',
            breakingChanges: [{ propertyId: 'variant', reason: 'type_changed' }],
          },
        },
      ],
    });
    const map = applyPreviewAnnotations(preview, ['Btn']);
    expect(map.get('Btn')).toBe('breaking');
  });

  it('mixed: 12 local, 2 unchanged, 1 changed, 0 removed → 9 new, 1 changed', () => {
    const localNames = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'C', 'U1', 'U2'];
    const preview = makePreview({
      changed: [
        {
          current: { id: 'c', name: 'C', contentProperties: [], designProperties: [], slots: [] },
          proposed: { $type: 'component', $properties: {} } as never,
          hasPendingDraftChanges: false,
          changeClassification: { classification: 'compatible', breakingChanges: [] },
        },
      ],
      unchanged: ['U1', 'U2'],
    });
    const map = applyPreviewAnnotations(preview, localNames);
    let newCount = 0;
    let changedCount = 0;
    for (const v of map.values()) {
      if (v === 'new') newCount++;
      if (v === 'changed') changedCount++;
    }
    expect(newCount).toBe(9);
    expect(changedCount).toBe(1);
    expect(map.has('U1')).toBe(false);
    expect(map.has('U2')).toBe(false);
  });

  it('removed components NOT in local manifest still get "removed"', () => {
    const preview = makePreview({
      removed: [{ id: 'd', name: 'D', contentProperties: [], designProperties: [], slots: [] }],
    });
    const map = applyPreviewAnnotations(preview, ['Other']);
    expect(map.get('D')).toBe('removed');
    expect(map.get('Other')).toBe('new');
  });

  it('omits unchanged components from the map', () => {
    const preview = makePreview({ unchanged: ['Stable'] });
    const map = applyPreviewAnnotations(preview, []);
    expect(map.has('Stable')).toBe(false);
  });

  it('handles a mixed set with all four states', () => {
    const preview = makePreview({
      changed: [
        {
          current: { id: 'b', name: 'B', contentProperties: [], designProperties: [], slots: [] },
          proposed: { $type: 'component', $properties: {} } as never,
          hasPendingDraftChanges: false,
          changeClassification: { classification: 'compatible', breakingChanges: [] },
        },
        {
          current: { id: 'c', name: 'C', contentProperties: [], designProperties: [], slots: [] },
          proposed: { $type: 'component', $properties: {} } as never,
          hasPendingDraftChanges: false,
          changeClassification: {
            classification: 'breaking',
            breakingChanges: [{ propertyId: 'p', reason: 'removed' }],
          },
        },
      ],
      removed: [{ id: 'd', name: 'D', contentProperties: [], designProperties: [], slots: [] }],
      unchanged: ['E'],
    });
    const map = applyPreviewAnnotations(preview, ['A', 'B', 'C', 'E']);
    expect(map.get('A')).toBe('new');
    expect(map.get('B')).toBe('changed');
    expect(map.get('C')).toBe('breaking');
    expect(map.get('D')).toBe('removed');
    expect(map.has('E')).toBe(false);
  });
});
