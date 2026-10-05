import { describe, it, expect } from 'vitest';
import { fuzzyMatches, fuzzyScore, fuzzyFilter } from '../../src/analyze/fuzzy-search.js';

describe('fuzzyMatches', () => {
  it('returns true for empty query on non-empty text', () => {
    expect(fuzzyMatches('', 'Anything')).toBe(true);
  });

  it('returns false for non-empty query on empty text', () => {
    expect(fuzzyMatches('a', '')).toBe(false);
  });

  it('returns true when both query and text are empty', () => {
    expect(fuzzyMatches('', '')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(fuzzyMatches('card', 'Card')).toBe(true);
  });

  it('matches as a subsequence (non-contiguous chars in order)', () => {
    expect(fuzzyMatches('crd', 'Card')).toBe(true);
  });

  it('returns false when a required char is missing', () => {
    expect(fuzzyMatches('cx', 'Card')).toBe(false);
  });

  it('respects char order — r cannot come before c in text', () => {
    expect(fuzzyMatches('rc', 'Card')).toBe(false);
  });

  it('matches substrings not anchored to the start', () => {
    expect(fuzzyMatches('page', 'ArticlePage')).toBe(true);
  });
});

describe('fuzzyScore', () => {
  it('returns null when there is no match', () => {
    expect(fuzzyScore('cx', 'Card')).toBeNull();
  });

  it('scores an exact match higher than a prefix-only match', () => {
    const exact = fuzzyScore('Card', 'Card');
    const prefix = fuzzyScore('Card', 'CardGroup');
    expect(exact).not.toBeNull();
    expect(prefix).not.toBeNull();
    expect(exact!).toBeGreaterThan(prefix!);
  });

  it('scores a prefix match higher than a mid-string match', () => {
    const prefix = fuzzyScore('Card', 'CardGroup');
    const mid = fuzzyScore('Card', 'HeroCard');
    expect(prefix).not.toBeNull();
    expect(mid).not.toBeNull();
    expect(prefix!).toBeGreaterThan(mid!);
  });

  it('scores a contiguous run higher than scattered matches', () => {
    const contiguous = fuzzyScore('crd', 'Card');
    const scattered = fuzzyScore('crd', 'CarouselHeroDivider');
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!).toBeGreaterThan(scattered!);
  });

  it('rewards case-sensitive equality over case-insensitive equivalent', () => {
    const caseMatch = fuzzyScore('Card', 'Card');
    const caseInsensitive = fuzzyScore('card', 'Card');
    expect(caseMatch).not.toBeNull();
    expect(caseInsensitive).not.toBeNull();
    expect(caseMatch!).toBeGreaterThan(caseInsensitive!);
  });

  it('returns a non-null number for empty query on non-empty text', () => {
    const score = fuzzyScore('', 'Anything');
    expect(score).not.toBeNull();
    expect(typeof score).toBe('number');
  });
});

describe('fuzzyFilter', () => {
  it('returns all candidates in input order when the query is empty', () => {
    expect(fuzzyFilter('', ['A', 'B'])).toEqual(['A', 'B']);
  });

  it('returns matching candidates sorted by descending score', () => {
    expect(fuzzyFilter('card', ['Hero', 'Card', 'CardGroup', 'Icon'])).toEqual(['Card', 'CardGroup']);
  });

  it('excludes candidates that do not match', () => {
    expect(fuzzyFilter('cx', ['Card', 'Cxel', 'Icon'])).toEqual(['Cxel']);
  });

  it('preserves input order on ties', () => {
    const result = fuzzyFilter('ab', ['abX', 'abY']);
    expect(result).toEqual(['abX', 'abY']);
  });
});
