import { describe, expect, it } from 'vitest';
import { parseAllowedValues } from '../../../src/extract/framework-adapters/stencil/helpers/extract-stencil-props.js';
import { parseStencilSlot } from '../../../src/extract/framework-adapters/stencil/helpers/extract-stencil-slots.js';

describe('parseAllowedValues', () => {
  it('parses a two-value string literal union', () => {
    expect(parseAllowedValues("'left' | 'right'")).toEqual(['left', 'right']);
  });

  it('parses a three-value string literal union and sorts values', () => {
    expect(parseAllowedValues("'z' | 'a' | 'm'")).toEqual(['a', 'm', 'z']);
  });

  it('returns undefined for a single quoted string (no union)', () => {
    expect(parseAllowedValues("'left'")).toBeUndefined();
  });

  it('returns undefined for plain string type', () => {
    expect(parseAllowedValues('string')).toBeUndefined();
  });

  it('returns undefined for number union', () => {
    expect(parseAllowedValues('1 | 2 | 3')).toBeUndefined();
  });

  it('strips surrounding whitespace from the type text', () => {
    expect(parseAllowedValues("  'a' | 'b'  ")).toEqual(['a', 'b']);
  });
});

describe('parseStencilSlot', () => {
  it('returns a default slot for undefined name', () => {
    expect(parseStencilSlot(undefined)).toEqual({ name: 'default', isDefault: true });
  });

  it('returns a default slot for empty string name', () => {
    expect(parseStencilSlot('')).toEqual({ name: 'default', isDefault: true });
  });

  it('returns a named slot for a non-empty name', () => {
    expect(parseStencilSlot('header')).toEqual({ name: 'header', isDefault: false });
  });

  it('marks slot as default when name is "default"', () => {
    expect(parseStencilSlot('default')).toEqual({ name: 'default', isDefault: true });
  });
});
