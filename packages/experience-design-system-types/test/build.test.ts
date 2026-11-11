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

// The API rejects a token property with no kind, after the preview has passed. Saving, previewing and pushing all build
// their document here, so what must hold is that none of them can send one: the kind is taken from the token file, or
// the property stops being a token property.
describe('buildCDF token properties without a kind', () => {
  const button = (prop: CDFComponentEntry['$properties'][string], name = 'color') => ({
    key: 'Button',
    entry: { $type: 'component' as const, $properties: { [name]: prop } },
  });
  const tokens: Array<{ path: string; entry: CDFTokenEntry }> = [
    { path: 'color.background', entry: { $type: 'color', $value: '#fff' } },
    { path: 'color.border', entry: { $type: 'color', $value: '#ccc' } },
    { path: 'spacing.md', entry: { $type: 'dimension', $value: '8px' } },
  ];

  // What the generation agent leaves behind when it cannot resolve a token, as in a real failing import.
  const unresolved = {
    $type: 'token' as const,
    $category: 'design' as const,
    $default: 'color.border',
    $description: 'Background color of the button. WARNING: token_kind unknown, color.border not found in token data',
  };

  it('takes the kind from the token the property defaults to, says so, and drops the stale warning', () => {
    const notes: string[] = [];

    // The property is called "tone", so only its default can tell the kind.
    const doc = buildCDF([button(unresolved, 'tone')], tokens, { onRepair: (note) => notes.push(note) });

    expect((doc?.Button as CDFComponentEntry).$properties['tone']).toMatchObject({
      $type: 'token',
      '$token.kind': 'color',
      $description: 'Background color of the button.',
    });
    expect(notes).toEqual([expect.stringContaining('Button.tone')]);
  });

  it('falls back to the tokens that carry the property name', () => {
    const doc = buildCDF([button({ $type: 'token', $category: 'design' })], tokens);

    expect((doc?.Button as CDFComponentEntry).$properties['color']).toMatchObject({ '$token.kind': 'color' });
  });

  it('saves it as a string property when the kind cannot be told, and never as a kind-less token', () => {
    const ambiguous = [
      { path: 'color.size', entry: { $type: 'color' as const, $value: '#fff' } },
      { path: 'text.size', entry: { $type: 'dimension' as const, $value: '8px' } },
    ];

    for (const available of [[], tokens, ambiguous]) {
      const doc = buildCDF(
        [button({ ...unresolved, $default: 'size.missing', '$token.allowed': ['spacing.md'] }, 'size')],
        available,
      );

      const prop = (doc?.Button as CDFComponentEntry).$properties['size']!;
      expect(prop.$type).toBe('string');
      // Token paths mean nothing on a string property, and the warning is no longer true of it.
      expect(prop).not.toHaveProperty('$token.allowed');
      expect(prop).not.toHaveProperty('$default');
      expect(prop.$description).toBe('Background color of the button.');
    }
  });

  it('leaves a token property that already has a kind alone', () => {
    const entry = button({ $type: 'token', $category: 'design', '$token.kind': 'dimension' });

    expect(buildCDF([entry], tokens)?.Button).toEqual(entry.entry);
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
