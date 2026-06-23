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
  it('marks new components as "new"', () => {
    const preview = makePreview({
      // `new` items are CDFComponentEntry but the server attaches the name on the
      // serialized payload — mirror the WizardApp.tsx access pattern at lines 332-333.
      new: [{ name: 'NewBtn', $type: 'component', $properties: {} }] as never,
    });
    const map = applyPreviewAnnotations(preview);
    expect(map.get('NewBtn')).toBe('new');
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
    const map = applyPreviewAnnotations(preview);
    expect(map.get('GoneBtn')).toBe('removed');
  });

  it('marks compatible-changed as "changed"', () => {
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
    const map = applyPreviewAnnotations(preview);
    expect(map.get('Btn')).toBe('changed');
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
    const map = applyPreviewAnnotations(preview);
    expect(map.get('Btn')).toBe('breaking');
  });

  it('omits unchanged components from the map', () => {
    const preview = makePreview({ unchanged: ['Stable'] });
    const map = applyPreviewAnnotations(preview);
    expect(map.has('Stable')).toBe(false);
  });

  it('handles a mixed set with all four states', () => {
    const preview = makePreview({
      new: [{ name: 'A', $type: 'component', $properties: {} }] as never,
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
    const map = applyPreviewAnnotations(preview);
    expect(map.get('A')).toBe('new');
    expect(map.get('B')).toBe('changed');
    expect(map.get('C')).toBe('breaking');
    expect(map.get('D')).toBe('removed');
    expect(map.has('E')).toBe(false);
  });
});
