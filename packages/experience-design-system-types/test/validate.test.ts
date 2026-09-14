import { describe, it, expect } from 'vitest';
import { validateCDF, CDF_V1_SCHEMA_URL } from '../src/cdf/index.js';

function minimalValidCDF() {
  return {
    $schema: CDF_V1_SCHEMA_URL,
    Button: {
      $type: 'component' as const,
      $properties: {
        label: { $type: 'string' as const, $category: 'content' as const },
      },
    },
  };
}

describe('validateCDF', () => {
  it('accepts a minimal valid CDF file', () => {
    const result = validateCDF(minimalValidCDF());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].key).toBe('Button');
  });

  it('rejects a file without $schema', () => {
    const result = validateCDF({
      Button: {
        $type: 'component',
        $properties: { label: { $type: 'string', $category: 'content' } },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid $schema value', () => {
    const result = validateCDF({
      $schema: 'https://example.com/wrong',
      Button: {
        $type: 'component',
        $properties: { label: { $type: 'string', $category: 'content' } },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a component without $properties', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Button: { $type: 'component' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a property without $type', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Button: {
        $type: 'component',
        $properties: {
          label: { $category: 'content' },
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a property without $category', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Button: {
        $type: 'component',
        $properties: {
          label: { $type: 'string' },
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid $type value on a property', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Button: {
        $type: 'component',
        $properties: {
          label: { $type: 'invalid_type', $category: 'content' },
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid $category value on a property', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Button: {
        $type: 'component',
        $properties: {
          label: { $type: 'string', $category: 'invalid_category' },
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('extracts components from nested groups', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      forms: {
        inputs: {
          TextInput: {
            $type: 'component',
            $properties: {
              value: { $type: 'string', $category: 'content' },
            },
          },
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].key).toBe('forms.inputs.TextInput');
  });

  it('ignores $-prefixed keys at top level', () => {
    const cdf = minimalValidCDF();
    const result = validateCDF(cdf);
    expect(result.valid).toBe(true);
    const keys = result.components.map((c) => c.key);
    expect(keys).not.toContain('$schema');
  });

  it('returns all errors in allErrors mode', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Button: {
        $type: 'component',
        $properties: {
          a: { $type: 'invalid1', $category: 'invalid1' },
          b: { $type: 'invalid2', $category: 'invalid2' },
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('accepts slots with $allowedComponents', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Card: {
        $type: 'component',
        $properties: {
          title: { $type: 'string', $category: 'content' },
        },
        $slots: {
          body: {
            $description: 'Card body content',
            $allowedComponents: ['Text', 'Image'],
          },
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.components).toHaveLength(1);
  });

  it('accepts boolean design properties', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Toggle: {
        $type: 'component',
        $properties: {
          visible: {
            $type: 'boolean',
            $category: 'design',
            $description: 'Whether the component is visible',
          },
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.components).toHaveLength(1);
  });

  it('accepts boolean design properties with boolean $default', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Toggle: {
        $type: 'component',
        $properties: {
          enabled: {
            $type: 'boolean',
            $category: 'design',
            $default: true,
          },
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.components).toHaveLength(1);
  });

  it('accepts token properties with $token.kind', () => {
    const result = validateCDF({
      $schema: CDF_V1_SCHEMA_URL,
      Button: {
        $type: 'component',
        $properties: {
          bgColor: {
            $type: 'token',
            $category: 'design',
            '$token.kind': 'color',
          },
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.components).toHaveLength(1);
  });
});
