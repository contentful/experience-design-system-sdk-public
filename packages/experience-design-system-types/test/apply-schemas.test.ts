import { describe, it, expect } from 'vitest';
import * as z from 'zod/mini';
import { CDFComponentSchema, CDFPropertySchema, CDFSlotSchema } from '../src/cdf/index.js';
import { DTCGTokenSchema } from '../src/dtcg/index.js';
import type { ApplyOperationItem } from '../src/sources-api/apply/index.js';

describe('ApplyOperationItem', () => {
  it('uses the canonical Component entity type from the operation API', () => {
    const item: ApplyOperationItem = {
      entityType: 'Component',
      id: 'button-id',
      action: 'create',
      status: 'succeeded',
    };
    expect(item.entityType).toBe('Component');
  });
});

describe('CDFPropertySchema', () => {
  it('accepts a minimal content property', () => {
    const result = z.safeParse(CDFPropertySchema, {
      $type: 'string',
      $category: 'content',
    });
    expect(result.success).toBe(true);
  });

  it('accepts the number property type', () => {
    const result = z.safeParse(CDFPropertySchema, {
      $type: 'number',
      $category: 'content',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a token design property with allowed token paths', () => {
    const result = z.safeParse(CDFPropertySchema, {
      $type: 'token',
      $category: 'design',
      '$token.allowed': ['color.brand.primary'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown $type', () => {
    const result = z.safeParse(CDFPropertySchema, {
      $type: 'not-a-real-type',
      $category: 'content',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys (strict object)', () => {
    const result = z.safeParse(CDFPropertySchema, {
      $type: 'string',
      $category: 'content',
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

describe('CDFSlotSchema', () => {
  it('accepts an empty slot definition', () => {
    const result = z.safeParse(CDFSlotSchema, {});
    expect(result.success).toBe(true);
  });

  it('accepts allowedComponents', () => {
    const result = z.safeParse(CDFSlotSchema, { $allowedComponents: ['Button'] });
    expect(result.success).toBe(true);
  });
});

describe('CDFComponentSchema', () => {
  it('accepts a minimal component entry', () => {
    const result = z.safeParse(CDFComponentSchema, {
      $type: 'component',
      $properties: {
        label: { $type: 'string', $category: 'content' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a component with slots', () => {
    const result = z.safeParse(CDFComponentSchema, {
      $type: 'component',
      $properties: {},
      $slots: { children: { $allowedComponents: ['Card'] } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a definition missing $properties', () => {
    const result = z.safeParse(CDFComponentSchema, { $type: 'component' });
    expect(result.success).toBe(false);
  });
});

describe('DTCGTokenSchema', () => {
  it('accepts a valid design token entry', () => {
    const result = z.safeParse(DTCGTokenSchema, {
      path: 'color.brand.primary',
      $type: 'color',
      $value: '#000000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a boolean $type (not a design-token vocabulary member)', () => {
    const result = z.safeParse(DTCGTokenSchema, {
      path: 'flag.enabled',
      $type: 'boolean',
      $value: true,
    });
    expect(result.success).toBe(false);
  });
});
