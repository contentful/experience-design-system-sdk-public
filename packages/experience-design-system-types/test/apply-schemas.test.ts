import { describe, it, expect } from 'vitest';
import * as z from 'zod/mini';
import { CDFComponentEntrySchema, CDFPropertyDefinitionSchema, CDFSlotDefinitionSchema } from '../src/cdf/index.js';
import { DTCGTokenEntrySchema } from '../src/dtcg/index.js';

describe('CDFPropertyDefinitionSchema', () => {
  it('accepts a minimal content property', () => {
    const result = z.safeParse(CDFPropertyDefinitionSchema, {
      $type: 'string',
      $category: 'content',
    });
    expect(result.success).toBe(true);
  });

  it('accepts the number property type', () => {
    const result = z.safeParse(CDFPropertyDefinitionSchema, {
      $type: 'number',
      $category: 'content',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown $type', () => {
    const result = z.safeParse(CDFPropertyDefinitionSchema, {
      $type: 'not-a-real-type',
      $category: 'content',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys (strict object)', () => {
    const result = z.safeParse(CDFPropertyDefinitionSchema, {
      $type: 'string',
      $category: 'content',
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

describe('CDFSlotDefinitionSchema', () => {
  it('accepts an empty slot definition', () => {
    const result = z.safeParse(CDFSlotDefinitionSchema, {});
    expect(result.success).toBe(true);
  });

  it('accepts allowedComponents', () => {
    const result = z.safeParse(CDFSlotDefinitionSchema, { $allowedComponents: ['Button'] });
    expect(result.success).toBe(true);
  });
});

describe('CDFComponentEntrySchema', () => {
  it('accepts a minimal component entry', () => {
    const result = z.safeParse(CDFComponentEntrySchema, {
      $type: 'component',
      $properties: {
        label: { $type: 'string', $category: 'content' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a component with slots', () => {
    const result = z.safeParse(CDFComponentEntrySchema, {
      $type: 'component',
      $properties: {},
      $slots: { children: { $allowedComponents: ['Card'] } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a definition missing $properties', () => {
    const result = z.safeParse(CDFComponentEntrySchema, { $type: 'component' });
    expect(result.success).toBe(false);
  });
});

describe('DTCGTokenEntrySchema', () => {
  it('accepts a valid design token entry', () => {
    const result = z.safeParse(DTCGTokenEntrySchema, {
      path: 'color.brand.primary',
      $type: 'color',
      $value: '#000000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a boolean $type (not a design-token vocabulary member)', () => {
    const result = z.safeParse(DTCGTokenEntrySchema, {
      path: 'flag.enabled',
      $type: 'boolean',
      $value: true,
    });
    expect(result.success).toBe(false);
  });
});
