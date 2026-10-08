import { describe, it, expect } from 'vitest';
import { buildCDF, buildFilteredCDF, CDF_SCHEMA_URL } from '../src/cdf/index.js';
import type { CDFComponentEntry, CDFTokenEntry } from '../src/cdf/index.js';

const CARD: { key: string; entry: CDFComponentEntry } = {
  key: 'Card',
  entry: { $type: 'component', $properties: {} },
};

const PRIMARY_COLOR: { path: string; entry: CDFTokenEntry } = {
  path: 'color.brand.primary',
  entry: { $type: 'color', $value: '#000000' },
};

describe('buildCDF', () => {
  it('merges a component and a token into one document', () => {
    const doc = buildCDF([CARD], [PRIMARY_COLOR]);
    expect(doc?.$schema).toBe(CDF_SCHEMA_URL);
    expect(doc?.Card).toEqual(CARD.entry);
    expect((doc?.color as Record<string, unknown>)?.brand).toEqual({ primary: PRIMARY_COLOR.entry });
  });

  it('returns undefined for no components and no tokens', () => {
    expect(buildCDF([], [])).toBeUndefined();
  });

  it('emits an empty-but-present document with deleteAll (server diffs as remove-all)', () => {
    const doc = buildCDF([], [], { deleteAll: true });
    expect(doc).toBeDefined();
    expect(Object.keys(doc ?? {})).toEqual(['$schema']);
  });

  it('supports components-only and tokens-only documents', () => {
    expect(buildCDF([CARD], [])?.Card).toBeDefined();
    expect((buildCDF([], [PRIMARY_COLOR])?.color as Record<string, unknown>)?.brand).toBeDefined();
  });
});

describe('buildCDF token path collisions', () => {
  const token = (path: string, value: string) => ({ path, entry: { $type: 'color', $value: value } as CDFTokenEntry });

  it('moves a token that is also a group parent into a default child', () => {
    const doc = buildCDF([], [token('button.primary', '#111'), token('button.primary.hover', '#222')]);
    const primary = (doc?.button as Record<string, unknown>).primary as Record<string, unknown>;
    expect(primary.default).toEqual({ $type: 'color', $value: '#111' });
    expect(primary.hover).toEqual({ $type: 'color', $value: '#222' });
  });

  it('is independent of token order', () => {
    const doc = buildCDF([], [token('a.b.c', '#2'), token('a.b', '#1')]);
    expect(((doc?.a as Record<string, unknown>).b as Record<string, unknown>).default).toEqual({
      $type: 'color',
      $value: '#1',
    });
  });

  it('avoids an existing default sibling', () => {
    const doc = buildCDF([], [token('a', '#1'), token('a.default', '#2')]);
    const a = doc?.a as Record<string, unknown>;
    expect(a.default).toEqual({ $type: 'color', $value: '#2' });
    expect(a.default_).toEqual({ $type: 'color', $value: '#1' });
  });

  it('leaves non-colliding tokens untouched', () => {
    const doc = buildCDF([], [token('a.b', '#1'), token('a.c', '#2')]);
    expect(doc?.a).toEqual({ b: { $type: 'color', $value: '#1' }, c: { $type: 'color', $value: '#2' } });
  });
});

describe('buildFilteredCDF', () => {
  it('keeps only selected component keys and token paths, preserving group nesting', () => {
    const full = buildCDF([CARD], [PRIMARY_COLOR])!;
    const filtered = buildFilteredCDF(full, new Set(['Card']), new Set());
    expect(filtered?.Card).toEqual(CARD.entry);
    expect(filtered?.color).toBeUndefined();
  });

  it('returns undefined when nothing is selected', () => {
    const full = buildCDF([CARD], [PRIMARY_COLOR])!;
    expect(buildFilteredCDF(full, new Set(), new Set())).toBeUndefined();
  });

  it('selects a nested token path without pulling in sibling tokens', () => {
    const full = buildCDF(
      [],
      [PRIMARY_COLOR, { path: 'color.brand.secondary', entry: { $type: 'color', $value: '#ffffff' } }],
    )!;
    const filtered = buildFilteredCDF(full, new Set(), new Set(['color.brand.primary']));
    expect((filtered?.color as Record<string, unknown>)?.brand).toEqual({ primary: PRIMARY_COLOR.entry });
  });
});
