import { describe, it, expect } from 'vitest';
import { isEmptyPreview } from '../../src/apply/preview-utils.js';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

function emptyPreview(): ServerPreviewResponse {
  return {
    components: { new: [], changed: [], unchanged: [], removed: [] },
    tokens: { new: [], changed: [], unchanged: [], removed: [] },
    taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
    suppressedDeletions: { components: 0, tokens: 0 },
  };
}

describe('isEmptyPreview', () => {
  it('returns true when all diff buckets are empty and no suppressedDeletions', () => {
    const preview = emptyPreview();
    expect(isEmptyPreview(preview)).toBe(true);
  });

  it('returns false when suppressedDeletions.components > 0', () => {
    const preview = emptyPreview();
    preview.suppressedDeletions.components = 1;
    expect(isEmptyPreview(preview)).toBe(false);
  });

  it('returns false when suppressedDeletions.tokens > 0', () => {
    const preview = emptyPreview();
    preview.suppressedDeletions.tokens = 2;
    expect(isEmptyPreview(preview)).toBe(false);
  });

  it('returns false when components.new has items', () => {
    const preview = emptyPreview();
    preview.components.new = [{ $type: 'component', $properties: {} }] as ServerPreviewResponse['components']['new'];
    expect(isEmptyPreview(preview)).toBe(false);
  });

  it('returns false when tokens.removed has items', () => {
    const preview = emptyPreview();
    preview.tokens.removed = [{ name: 'TokenName' }] as ServerPreviewResponse['tokens']['removed'];
    expect(isEmptyPreview(preview)).toBe(false);
  });

  it('handles suppressedDeletions with zero values gracefully', () => {
    const preview = emptyPreview();
    preview.suppressedDeletions = { components: 0, tokens: 0 };
    expect(isEmptyPreview(preview)).toBe(true);
  });
});
