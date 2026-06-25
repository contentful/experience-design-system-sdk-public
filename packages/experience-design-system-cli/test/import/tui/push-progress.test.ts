import { describe, it, expect } from 'vitest';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { computePushExpected } from '../../../src/import/tui/push-progress.js';

function makePreview(overrides: {
  componentsNew?: unknown[];
  componentsChanged?: unknown[];
  componentsRemoved?: unknown[];
  tokensNew?: unknown[];
  tokensChanged?: unknown[];
  tokensRemoved?: unknown[];
}): ServerPreviewResponse {
  return {
    components: {
      new: (overrides.componentsNew ?? []) as never[],
      changed: (overrides.componentsChanged ?? []) as never[],
      unchanged: [],
      removed: (overrides.componentsRemoved ?? []) as never[],
    },
    tokens: {
      new: (overrides.tokensNew ?? []) as never[],
      changed: (overrides.tokensChanged ?? []) as never[],
      unchanged: [],
      removed: (overrides.tokensRemoved ?? []) as never[],
    },
    taxonomies: {
      new: [],
      changed: [],
      unchanged: [],
      removed: [],
    },
  };
}

describe('computePushExpected', () => {
  it('counts all six buckets when populated', () => {
    const preview = makePreview({
      componentsNew: [{}, {}, {}],
      componentsChanged: [{}, {}],
      componentsRemoved: [{}],
      tokensNew: [{}, {}, {}, {}],
      tokensChanged: [{}],
      tokensRemoved: [{}, {}],
    });
    expect(computePushExpected(preview)).toEqual({
      componentTypes: { create: 3, update: 2, remove: 1 },
      designTokens: { create: 4, update: 1, remove: 2 },
    });
  });

  it('returns zeros for empty buckets', () => {
    const preview = makePreview({});
    expect(computePushExpected(preview)).toEqual({
      componentTypes: { create: 0, update: 0, remove: 0 },
      designTokens: { create: 0, update: 0, remove: 0 },
    });
  });

  it('tolerates missing removed lists', () => {
    const preview = {
      components: { new: [{}], changed: [], unchanged: [] },
      tokens: { new: [], changed: [{}], unchanged: [] },
      taxonomies: { new: [], changed: [], unchanged: [] },
    } as unknown as ServerPreviewResponse;
    expect(computePushExpected(preview)).toEqual({
      componentTypes: { create: 1, update: 0, remove: 0 },
      designTokens: { create: 0, update: 1, remove: 0 },
    });
  });
});
