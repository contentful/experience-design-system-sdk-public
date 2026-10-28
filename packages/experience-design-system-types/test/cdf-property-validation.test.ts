import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  cdfDefinitionChildren,
  cdfToTarget,
  containsCDFDefinitionType,
  targetToCDF,
  validateCDFProperty,
} from '../src/cdf/property-validation.js';
import { finiteValuesIssue, isFinitePrimitiveType, isFinitePrimitiveValue } from '../src/cdf/finite-values.js';
import { CDF_FIELD_TYPES, CDF_PROPERTY_TYPES } from '../src/cdf/vocabularies.js';
import { contentDigest } from '../src/property-contract/content-digest.js';
import type { CDFFieldDefinition } from '../src/cdf/types.js';
import type { TargetDefinition } from '../src/property-contract/target-definition.js';

const sourceInput = {
  schemaVersion: 1,
  componentId: 'Card',
  componentDeclarationId: 'src/Card.tsx#Card',
  rootSymbolId: 'CardProps',
  inputName: 'items',
  inputPath: ['items'],
};

describe('vocabularies', () => {
  it('keeps the live CDF_PROPERTY_TYPES unchanged', () => {
    expect(CDF_PROPERTY_TYPES).toEqual(['string', 'richtext', 'number', 'media', 'link', 'enum', 'token', 'boolean']);
  });

  it('CDF_FIELD_TYPES drops enum and adds the structured types', () => {
    expect(CDF_FIELD_TYPES).not.toContain('enum');
    for (const type of ['array', 'record', 'Integer', 'DateTime', 'Literal', 'RichText', 'JSON', 'ResourceLink'])
      expect(CDF_FIELD_TYPES).toContain(type);
  });
});

describe('finite values', () => {
  it('only string, number and boolean are finite primitive types', () => {
    expect(['string', 'number', 'boolean'].every(isFinitePrimitiveType)).toBe(true);
    expect(isFinitePrimitiveType('enum')).toBe(false);
    expect(isFinitePrimitiveType('array')).toBe(false);
  });

  it('rejects non-finite numbers', () => {
    expect(isFinitePrimitiveValue(1)).toBe(true);
    expect(isFinitePrimitiveValue(Number.NaN)).toBe(false);
    expect(isFinitePrimitiveValue(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('reports empty, mistyped and duplicate members with their index', () => {
    expect(finiteValuesIssue('string', ['a', 'b'])).toBeUndefined();
    expect(finiteValuesIssue('string', [])?.message).toMatch(/at least one/);
    expect(finiteValuesIssue('string', ['a', 1])).toMatchObject({ index: 1 });
    expect(finiteValuesIssue('number', [1, 1])).toMatchObject({
      index: 1,
      message: expect.stringMatching(/duplicate/),
    });
    expect(finiteValuesIssue('array', ['a'])?.message).toMatch(/only valid/);
  });
});

describe('validateCDFProperty', () => {
  it('accepts a primitive with finite $values', () => {
    expect(validateCDFProperty({ $type: 'string', $category: 'content', $values: ['sm', 'md'] })).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('rejects the retired enum type', () => {
    const result = validateCDFProperty({ $type: 'enum', $category: 'content', $values: ['a'] });
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([{ path: '/$type', message: 'Unknown CDF type' }]);
  });

  it('requires a root category unless told otherwise', () => {
    expect(validateCDFProperty({ $type: 'string' }).issues).toEqual([
      { path: '/$category', message: 'Unknown category' },
    ]);
    expect(validateCDFProperty({ $type: 'string' }, false).valid).toBe(true);
  });

  it('validates nested array items and record fields with exact paths', () => {
    const result = validateCDFProperty({
      $type: 'array',
      $category: 'content',
      $items: { $type: 'record', $fields: { title: { $type: 'string', $values: [1] } } },
    });
    expect(result.issues).toEqual([
      { path: '/$items/$fields/title/$values/0', message: 'Each $values member must match the string type' },
    ]);
  });

  it('rejects an empty record', () => {
    expect(validateCDFProperty({ $type: 'record', $category: 'content', $fields: {} }).issues).toEqual([
      { path: '/$fields', message: 'Expected nonempty field dictionary' },
    ]);
  });

  it('rejects metadata that does not belong to the type', () => {
    expect(validateCDFProperty({ $type: 'string', $category: 'content', $items: { $type: 'string' } }).issues).toEqual([
      { path: '/$items', message: 'Unexpected property metadata' },
    ]);
  });

  it('requires the content category for richer representations', () => {
    expect(validateCDFProperty({ $type: 'JSON', $category: 'design' }).issues).toContainEqual({
      path: '/$category',
      message: 'Richer representations require content category',
    });
  });

  it('accepts a valid $sourceInput only at the root', () => {
    expect(validateCDFProperty({ $type: 'string', $category: 'content', $sourceInput: sourceInput }).valid).toBe(true);
    expect(
      validateCDFProperty({ $type: 'string', $category: 'content', $sourceInput: { ...sourceInput, inputPath: ['x'] } })
        .issues,
    ).toContainEqual({ path: '/$sourceInput', message: 'Invalid source input association' });
    expect(
      validateCDFProperty({
        $type: 'array',
        $category: 'content',
        $items: { $type: 'string', $sourceInput: sourceInput },
      }).issues,
    ).toContainEqual({ path: '/$items/$sourceInput', message: 'Unexpected property metadata' });
  });

  it('maps target-level issues back onto CDF paths', () => {
    const result = validateCDFProperty({
      $type: 'array',
      $category: 'content',
      $items: { $type: 'number' },
      $default: ['not a number'],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.every((issue) => !/\/(defaultValue|items)(\/|$)/.test(issue.path))).toBe(true);
    expect(result.issues.some((issue) => issue.path.startsWith('/$default'))).toBe(true);
  });

  it('rejects non-objects, non-JSON input and unbounded depth', () => {
    expect(validateCDFProperty(null).valid).toBe(false);
    expect(validateCDFProperty({ $type: 'string', $category: 'content', $default: () => 1 }).valid).toBe(false);
    let deep: Record<string, unknown> = { $type: 'string' };
    for (let i = 0; i < 70; i++) deep = { $type: 'array', $items: deep };
    expect(validateCDFProperty({ ...deep, $category: 'content' }).valid).toBe(false);
  });
});

describe('CDF ↔ target conversion', () => {
  const field: CDFFieldDefinition = {
    $type: 'record',
    $required: true,
    $description: 'A card',
    $fields: {
      title: { $type: 'string', $default: 'Hello' },
      tags: { $type: 'array', $items: { $type: 'string', $values: ['a', 'b'] } },
      kind: {
        $type: 'DiscriminatedUnion',
        discriminator: 'kind',
        members: [
          { $type: 'record', $fields: { kind: { $type: 'Literal', value: 'a', valueType: { $type: 'string' } } } },
        ],
      },
    },
  };

  it('converts CDF fields to target definitions', () => {
    const target = cdfToTarget(field);
    expect(target).toMatchObject({ type: 'Record', required: true, description: 'A card' });
    expect(target.fields?.tags).toEqual({ type: 'Array', items: { type: 'String', values: ['a', 'b'] } });
  });

  it('round-trips through targetToCDF', () => {
    expect(targetToCDF(cdfToTarget(field))).toEqual(field);
  });

  it('maps string-like CDF types onto String', () => {
    for (const $type of ['richtext', 'media', 'link', 'token'] as const)
      expect(cdfToTarget({ $type }).type).toBe('String');
  });

  it('clones values instead of sharing them', () => {
    const target: TargetDefinition = { type: 'Array', items: { type: 'String' }, defaultValue: ['x'] };
    const cdf = targetToCDF(target);
    (cdf.$default as string[]).push('y');
    expect(target.defaultValue).toEqual(['x']);
  });

  it('lists every recursive child with its path', () => {
    expect(cdfDefinitionChildren(field).map((child) => child.path)).toEqual([
      '/$fields/title',
      '/$fields/tags',
      '/$fields/kind',
    ]);
    expect(cdfDefinitionChildren(field.$fields!.kind!).map((child) => child.path)).toEqual(['/members/0']);
  });

  it('finds nested types', () => {
    expect(containsCDFDefinitionType(field, 'Literal')).toBe(true);
    expect(containsCDFDefinitionType(field, 'JSON')).toBe(false);
  });
});

describe('contentDigest', () => {
  const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

  it('matches node:crypto SHA-256 of the canonical JSON', () => {
    expect(contentDigest('')).toBe(sha256('""'));
    expect(contentDigest({ b: 1, a: [true, null, 'é'] })).toBe(sha256('{"a":[true,null,"é"],"b":1}'));
  });

  it('is stable across key order', () => {
    expect(contentDigest({ a: 1, b: { c: 2, d: 3 } })).toBe(contentDigest({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('handles inputs spanning several SHA-256 blocks', () => {
    for (const length of [55, 56, 63, 64, 119, 1000]) {
      const text = 'x'.repeat(length);
      expect(contentDigest(text)).toBe(sha256(JSON.stringify(text)));
    }
  });

  it('throws on values that are not plain JSON', () => {
    expect(() => contentDigest({ a: undefined })).toThrow();
    expect(() => contentDigest(new Date())).toThrow();
  });
});
