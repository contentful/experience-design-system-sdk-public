import { describe, it, expect } from 'vitest';
import { validateCDF } from '@contentful/experience-design-system-types';

const withProp = (prop: Record<string, unknown>) => ({
  $schema: 'https://contentful.com/schemas/cdf/v1',
  Badge: { $type: 'component', $properties: { variant: prop } },
});

describe('token property contract', () => {
  const TOKENS = {
    color: { blue: { 500: { $type: 'color', $value: '#00f' } }, red: { 500: { $type: 'color', $value: '#f00' } } },
    space: { md: { $type: 'dimension', $value: '8px' } },
  };

  it('accepts $token.allowed naming real tokens of the property kind', () => {
    const result = validateCDF(
      withProp({
        $type: 'token',
        $category: 'design',
        '$token.kind': 'color',
        '$token.allowed': ['color.blue.500'],
      }),
      { tokens: TOKENS },
    );
    expect(result.valid).toBe(true);
  });

  it('rejects $token.allowed naming a token of the wrong kind', () => {
    const result = validateCDF(
      withProp({
        $type: 'token',
        $category: 'design',
        '$token.kind': 'color',
        '$token.allowed': ['space.md'],
      }),
      { tokens: TOKENS },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('space.md (dimension)');
  });

  it('rejects a $token.sets property outright — it left the format', () => {
    const result = validateCDF(
      withProp({
        $type: 'token',
        $category: 'design',
        '$token.kind': 'color',
        '$token.sets': ['color.blue.500'],
        '$token.allowed': ['color.blue.500'],
      }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects $values on a token-typed property', () => {
    const result = validateCDF(
      withProp({
        $type: 'token',
        $category: 'design',
        '$token.kind': 'color',
        $values: ['primary', 'secondary'],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('/Badge/$properties/variant/$values');
  });

  it('rejects $token.allowed without $token.kind', () => {
    const result = validateCDF(
      withProp({ $type: 'token', $category: 'design', '$token.allowed': ['color.blue.500'] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('/Badge/$properties/variant/$token.allowed');
  });

  it('rejects $token.allowed on a non-token property', () => {
    const result = validateCDF(
      withProp({ $type: 'enum', $category: 'design', $values: ['a'], '$token.allowed': ['color.blue.500'] }),
    );
    expect(result.valid).toBe(false);
  });

  it('accepts a token property with kind and allowed', () => {
    const result = validateCDF(
      withProp({
        $type: 'token',
        $category: 'design',
        '$token.kind': 'color',
        '$token.allowed': ['color.blue.500', 'color.red.500'],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts an enum property with values', () => {
    const result = validateCDF(
      withProp({ $type: 'enum', $category: 'design', $values: ['primary', 'secondary'] }),
    );
    expect(result.valid).toBe(true);
  });
});
