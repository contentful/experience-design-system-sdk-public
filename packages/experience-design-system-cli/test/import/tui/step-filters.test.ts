import { describe, expect, it } from 'vitest';
import { buildFlatDimPredicate, computeFilterKeys, intersectFilterKeys } from '../../../src/import/tui/step-filters.js';

describe('computeFilterKeys', () => {
  const data = {
    cycles: ['NodeA', 'NodeB'],
    broken: ['BadgeIcon', 'DivWrapper'],
    deleted: ['OldThing'],
  };

  it('returns undefined when no filter is active', () => {
    expect(computeFilterKeys({ filters: [], data })).toBeUndefined();
  });

  it('cycles filter returns exactly the cycle set', () => {
    const out = computeFilterKeys({ filters: ['cycles'], data });
    expect(out).toEqual(new Set(['NodeA', 'NodeB']));
  });

  it('broken filter returns exactly the broken set', () => {
    const out = computeFilterKeys({ filters: ['broken'], data });
    expect(out).toEqual(new Set(['BadgeIcon', 'DivWrapper']));
  });

  it('deleted filter returns exactly the deleted set', () => {
    const out = computeFilterKeys({ filters: ['deleted'], data });
    expect(out).toEqual(new Set(['OldThing']));
  });

  it('multiple active filters union their key sets', () => {
    const out = computeFilterKeys({ filters: ['cycles', 'broken'], data });
    expect(out).toEqual(new Set(['NodeA', 'NodeB', 'BadgeIcon', 'DivWrapper']));
  });

  it('active filter with a missing data source contributes nothing (empty set, no crash)', () => {
    const out = computeFilterKeys({ filters: ['deleted'], data: { cycles: ['X'] } });
    expect(out).toEqual(new Set<string>());
  });

  it('active filter with an empty data source yields an empty set (graceful no-match)', () => {
    const out = computeFilterKeys({ filters: ['broken'], data: { broken: [] } });
    expect(out).toEqual(new Set<string>());
  });

  it('dedupes keys that appear in more than one active filter', () => {
    const out = computeFilterKeys({
      filters: ['cycles', 'broken'],
      data: { cycles: ['Shared', 'NodeA'], broken: ['Shared', 'BadgeIcon'] },
    });
    expect(out).toEqual(new Set(['Shared', 'NodeA', 'BadgeIcon']));
  });
});

describe('intersectFilterKeys', () => {
  it('returns the other set when one side is undefined', () => {
    const s = new Set(['A', 'B']);
    expect(intersectFilterKeys(undefined, s)).toBe(s);
    expect(intersectFilterKeys(s, undefined)).toBe(s);
  });

  it('returns undefined when both are undefined', () => {
    expect(intersectFilterKeys(undefined, undefined)).toBeUndefined();
  });

  it('returns the intersection when both are defined', () => {
    const out = intersectFilterKeys(new Set(['A', 'B', 'C']), new Set(['B', 'C', 'D']));
    expect(out).toEqual(new Set(['B', 'C']));
  });

  it('empty intersection yields an empty set', () => {
    const out = intersectFilterKeys(new Set(['A']), new Set(['B']));
    expect(out).toEqual(new Set<string>());
  });
});

describe('buildFlatDimPredicate', () => {
  it('returns undefined in grouped view even with an active filter (grouped hides, never dims)', () => {
    const pred = buildFlatDimPredicate({
      viewMode: 'grouped',
      searchQuery: '',
      filterVisibleKeys: new Set(['Broken']),
    });
    expect(pred).toBeUndefined();
  });

  it('returns undefined in flat view when nothing is active', () => {
    const pred = buildFlatDimPredicate({
      viewMode: 'flat',
      searchQuery: '',
      filterVisibleKeys: undefined,
    });
    expect(pred).toBeUndefined();
  });

  it('flat view + category filter: dims names NOT in the filter set, keeps matches bright', () => {
    const pred = buildFlatDimPredicate({
      viewMode: 'flat',
      searchQuery: '',
      filterVisibleKeys: new Set(['Broken', 'AlsoBroken']),
    });
    expect(pred).toBeDefined();
    expect(pred!('NotBroken')).toBe(true);
    expect(pred!('Broken')).toBe(false);
    expect(pred!('AlsoBroken')).toBe(false);
  });

  it('flat view + focus-lineage (ancestor set) dims non-ancestors', () => {
    const pred = buildFlatDimPredicate({
      viewMode: 'flat',
      searchQuery: '',
      filterVisibleKeys: new Set(['Target', 'ParentOfTarget']),
    });
    expect(pred!('Unrelated')).toBe(true);
    expect(pred!('Target')).toBe(false);
    expect(pred!('ParentOfTarget')).toBe(false);
  });

  it('flat view + search only: dims fuzzy non-matches (existing behavior preserved)', () => {
    const pred = buildFlatDimPredicate({
      viewMode: 'flat',
      searchQuery: 'card',
      filterVisibleKeys: undefined,
    });
    expect(pred!('Card')).toBe(false);
    expect(pred!('Heading')).toBe(true);
  });
});
