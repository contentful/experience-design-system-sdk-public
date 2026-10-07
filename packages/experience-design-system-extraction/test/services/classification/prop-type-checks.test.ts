import { describe, expect, it } from 'vitest';
import {
  isSimpleType,
  isStringLiteralUnion,
  isBooleanType,
  isStringType,
  isNumberType,
  isComplexType,
} from '../../../src/extract/services/classification/helpers/check-prop-types.js';

describe('isStringLiteralUnion', () => {
  it('returns true for a quoted union', () => {
    expect(isStringLiteralUnion("'a' | 'b' | 'c'")).toBe(true);
  });

  it('returns false for a plain string type', () => {
    expect(isStringLiteralUnion('string')).toBe(false);
  });

  it('returns false for a pipe with no quotes', () => {
    expect(isStringLiteralUnion('string | number')).toBe(false);
  });
});

describe('isSimpleType', () => {
  it('returns true for string', () => expect(isSimpleType('string')).toBe(true));
  it('returns true for boolean', () => expect(isSimpleType('boolean')).toBe(true));
  it('returns true for number', () => expect(isSimpleType('number')).toBe(true));

  it('returns true for string literal union', () => {
    expect(isSimpleType("'left' | 'right'")).toBe(true);
  });

  it('returns false for object type', () => {
    expect(isSimpleType('{ id: string }')).toBe(false);
  });

  it('returns false for array type', () => {
    expect(isSimpleType('string[]')).toBe(false);
  });

  it('strips surrounding whitespace', () => {
    expect(isSimpleType('  string  ')).toBe(true);
  });
});

describe('isBooleanType', () => {
  it('returns true for boolean', () => expect(isBooleanType('boolean')).toBe(true));
  it('returns true with leading/trailing whitespace', () => expect(isBooleanType('  boolean  ')).toBe(true));
  it('returns false for string', () => expect(isBooleanType('string')).toBe(false));
  it('returns false for boolean union', () => expect(isBooleanType('boolean | undefined')).toBe(false));
});

describe('isStringType', () => {
  it('returns true for string', () => expect(isStringType('string')).toBe(true));
  it('returns true with whitespace', () => expect(isStringType('  string  ')).toBe(true));
  it('returns false for string[]', () => expect(isStringType('string[]')).toBe(false));
  it('returns false for boolean', () => expect(isStringType('boolean')).toBe(false));
});

describe('isNumberType', () => {
  it('returns true for number', () => expect(isNumberType('number')).toBe(true));
  it('returns true with whitespace', () => expect(isNumberType('  number  ')).toBe(true));
  it('returns false for string', () => expect(isNumberType('string')).toBe(false));
});

describe('isComplexType', () => {
  it('returns true for object type', () => expect(isComplexType('{ id: string }')).toBe(true));
  it('returns true for generic type', () => expect(isComplexType('Array<string>')).toBe(true));
  it('returns false for string (simple)', () => expect(isComplexType('string')).toBe(false));
  it('returns false for string literal union (simple)', () => {
    expect(isComplexType("'a' | 'b'")).toBe(false);
  });
});
