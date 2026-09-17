import { describe, it, expect } from 'vitest';
import {
  mapContentfulTypeToCdfType,
  resolveCdfCategory,
} from '../../../../src/session/core/cdf/contentful-type-map.js';

describe('mapContentfulTypeToCdfType', () => {
  const cases: Array<[string, string]> = [
    ['string', 'string'],
    ['text', 'string'],
    ['richtext', 'richtext'],
    ['media', 'media'],
    ['link', 'link'],
    ['enum', 'enum'],
    ['symbol', 'enum'],
    ['token', 'token'],
    ['boolean', 'boolean'],
    ['unknown-thing', 'string'],
  ];

  it.each(cases)('maps %s → %s', (input, expected) => {
    expect(mapContentfulTypeToCdfType(input)).toBe(expected);
  });

  it('lower-cases input before matching', () => {
    expect(mapContentfulTypeToCdfType('SYMBOL')).toBe('enum');
  });
});

describe('resolveCdfCategory', () => {
  const content = new Set(['title', 'body']);
  const design = new Set(['color', 'padding']);

  it('trusts a valid Contentful-provided category', () => {
    expect(resolveCdfCategory('content', 'anything', content, design)).toBe('content');
    expect(resolveCdfCategory('design', 'anything', content, design)).toBe('design');
    expect(resolveCdfCategory('state', 'anything', content, design)).toBe('state');
  });

  it('falls back to contentProps when Contentful category is missing', () => {
    expect(resolveCdfCategory(null, 'title', content, design)).toBe('content');
  });

  it('falls back to designProps when Contentful category is missing', () => {
    expect(resolveCdfCategory(null, 'color', content, design)).toBe('design');
  });

  it('defaults to state when the prop is in neither set', () => {
    expect(resolveCdfCategory(null, 'other', content, design)).toBe('state');
  });

  it('ignores an invalid Contentful category and falls back', () => {
    expect(resolveCdfCategory('nonsense', 'title', content, design)).toBe('content');
    expect(resolveCdfCategory('nonsense', 'other', content, design)).toBe('state');
  });
});
