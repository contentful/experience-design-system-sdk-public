import { describe, it, expect } from 'vitest';
import { validateCDF, CDF_SCHEMA_URL } from '../src/cdf/index.js';

function minimalCDFDocument() {
  return {
    $schema: CDF_SCHEMA_URL,
    Button: {
      $type: 'component' as const,
      $properties: {
        label: { $type: 'string' as const, $category: 'content' as const },
      },
    },
    color: {
      brand: {
        primary: { $type: 'color' as const, $value: '#000000' },
      },
    },
  };
}

describe('validateCDF', () => {
  it('accepts a merged document containing both a component and a token', () => {
    const result = validateCDF(minimalCDFDocument());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].key).toBe('Button');
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].path).toBe('color.brand.primary');
    expect(result.tokens[0].entry.$value).toBe('#000000');
  });

  it('accepts a document with only components', () => {
    const result = validateCDF({
      $schema: CDF_SCHEMA_URL,
      Button: { $type: 'component', $properties: {} },
    });
    expect(result.valid).toBe(true);
    expect(result.components).toHaveLength(1);
    expect(result.tokens).toHaveLength(0);
  });

  it('accepts a document with only tokens', () => {
    const result = validateCDF({
      $schema: CDF_SCHEMA_URL,
      spacing: { small: { $type: 'dimension', $value: '4px' } },
    });
    expect(result.valid).toBe(true);
    expect(result.components).toHaveLength(0);
    expect(result.tokens).toHaveLength(1);
  });

  it('rejects a file without $schema', () => {
    const result = validateCDF({
      Button: { $type: 'component', $properties: {} },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a stale/unknown schema URL', () => {
    const result = validateCDF({
      $schema: 'https://contentful.com/schemas/cdf/v1',
      Button: { $type: 'component', $properties: {} },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].expected).toContain(CDF_SCHEMA_URL);
  });

  it('rejects a token with an unknown $type', () => {
    const result = validateCDF({
      $schema: CDF_SCHEMA_URL,
      spacing: { small: { $type: 'not-a-real-type', $value: '4px' } },
    });
    expect(result.valid).toBe(false);
  });
});
