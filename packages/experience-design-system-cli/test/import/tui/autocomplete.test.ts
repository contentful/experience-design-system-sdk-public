import { describe, it, expect } from 'vitest';

import { computeAutocomplete } from '../../../src/import/tui/autocomplete.js';

describe('computeAutocomplete (L4 — shell-style Tab autocomplete)', () => {
  it('0 candidates → completion unchanged, candidates empty', () => {
    const result = computeAutocomplete('zzz', ['Widget', 'Wizard', 'Waffle']);
    expect(result.completion).toBe('zzz');
    expect(result.candidates).toEqual([]);
  });

  it('exactly 1 candidate → completion is that full name, candidates empty', () => {
    const result = computeAutocomplete('Wid', ['Widget', 'Card', 'Modal']);
    expect(result.completion).toBe('Widget');
    expect(result.candidates).toEqual([]);
  });

  it('multiple candidates sharing a longer prefix → completion is the LCP (longer than query)', () => {
    const result = computeAutocomplete('W', ['Widget', 'Widened', 'Card']);
    expect(result.completion).toBe('Wid');
    expect(result.completion.length).toBeGreaterThan('W'.length);
    expect(result.candidates).toEqual(['Widened', 'Widget']);
  });

  it('multiple candidates with no common prefix beyond the query → completion unchanged, candidates listed', () => {
    const result = computeAutocomplete('W', ['Widget', 'Wizard', 'Waffle']);
    expect(result.completion).toBe('W');
    expect(result.candidates).toEqual(['Waffle', 'Widget', 'Wizard']);
  });

  it('is case-insensitive when matching', () => {
    const result = computeAutocomplete('wid', ['Widget', 'Widened', 'Card']);
    expect(result.candidates).toEqual(['Widened', 'Widget']);
    expect(result.completion.length).toBeGreaterThanOrEqual('wid'.length);
    expect(result.completion.toLowerCase()).toBe('wid');
  });

  it('completion is never shorter than the query', () => {
    const result = computeAutocomplete('WI', ['Widget', 'Wizard']);
    expect(result.completion.length).toBeGreaterThanOrEqual('WI'.length);
  });

  it('empty query with multiple names → LCP across all', () => {
    const result = computeAutocomplete('', ['Alpha', 'Alto', 'Alps']);
    expect(result.completion).toBe('Al');
    expect(result.candidates).toEqual(['Alpha', 'Alps', 'Alto']);
  });
});
