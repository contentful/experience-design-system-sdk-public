import { describe, it, expect } from 'vitest';
import { buildDtcgGroups } from '../../../../src/session/core/tokens/build-dtcg-groups.js';

describe('buildDtcgGroups', () => {
  it('returns [] when there are no group rows', () => {
    expect(buildDtcgGroups([], [])).toEqual([]);
  });

  it('propagates group descriptions when present', () => {
    const groups = buildDtcgGroups([{ path: 'color.brand', description: 'Brand colors' }], []);
    expect(groups[0]?.$description).toBe('Brand colors');
  });

  it('omits $description when the row has null description', () => {
    const groups = buildDtcgGroups([{ path: 'color', description: null }], []);
    expect(groups[0]).not.toHaveProperty('$description');
  });

  it('assigns direct-child tokens to their group and excludes nested descendants', () => {
    const groups = buildDtcgGroups(
      [{ path: 'color.brand', description: null }],
      [
        { path: 'color.brand.primary', type: 'color', value: '"#f00"', description: null },
        { path: 'color.brand.accent.hover', type: 'color', value: '"#0f0"', description: null },
      ],
    );
    expect(groups[0]?.tokenIds).toEqual(['color.brand.primary']);
  });
});
