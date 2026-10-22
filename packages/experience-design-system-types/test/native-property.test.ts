import { describe, expect, it } from 'vitest';
import {
  buildCDF,
  validateCDF,
  CDFComponentSchema,
  CDFPropertySchema,
  type CDFPropertyDefinition,
} from '../src/index.js';
import * as api from '../src/index.js';

it('exposes immutable revision two projection and eleven target validation', () => {
  expect(api).toHaveProperty('createPropertyProfile');
  expect(api).toHaveProperty('validateTargetDefinition');
  expect(api).toHaveProperty('validateRepresentationProposal');
});

describe('native recursive CDF', () => {
  it('accepts exact root Array<Record> fields and typed aggregate defaults', () => {
    const property = JSON.parse(
      '{"$type":"array","$category":"content","$required":false,"$items":{"$type":"record","$required":true,"$fields":{"__proto__":{"$type":"boolean","$required":false},"a.b/λ":{"$type":"number","$required":true}}},"$default":[{"__proto__":false,"a.b/λ":0}]}',
    );
    const cdf = buildCDF([{ key: 'Example', entry: { $type: 'component', $properties: { rows: property } } }], []);
    expect(validateCDF(cdf)).toMatchObject({ valid: true });
    expect(JSON.parse(JSON.stringify(cdf))).toEqual(cdf);
  });
  it('rejects wrong aggregate defaults and empty record definitions', () => {
    for (const property of [
      { $type: 'array', $category: 'content', $items: { $type: 'number' }, $default: ['wrong'] },
      { $type: 'record', $category: 'content', $fields: {} },
    ]) {
      const entry = { $type: 'component' as const, $properties: { rows: property as never } };
      const cdf = { Example: entry };
      expect(validateCDF(cdf).valid).toBe(false);
      expect(() => buildCDF([{ key: 'Example', entry }], [])).toThrow('Invalid CDF prerequisites');
    }
  });
  it.each(['root', 'item', 'field'] as const)('preserves validated union metadata at the %s position', (position) => {
    const choice: CDFPropertyDefinition = {
      $type: 'DiscriminatedUnion',
      $category: 'content',
      discriminator: 'kind',
      members: ['a', 'b'].map((value) => ({
        $type: 'record',
        $fields: {
          kind: { $type: 'Literal', $required: true, value, valueType: { $type: 'string' } },
          title: { $type: 'string', $required: true },
        },
      })),
    };
    const property: CDFPropertyDefinition =
      position === 'root'
        ? choice
        : position === 'item'
          ? { $type: 'array', $category: 'content', $items: choice }
          : { $type: 'record', $category: 'content', $fields: { choice } };
    const entry = { $type: 'component' as const, $properties: { choice: property } };
    expect(CDFPropertySchema.safeParse(property).success).toBe(true);
    expect(CDFComponentSchema.safeParse(entry).success).toBe(true);
    const cdf = buildCDF([{ key: 'Example', entry }], []);
    expect(validateCDF(cdf).valid).toBe(true);
    expect(JSON.parse(JSON.stringify(cdf))).toEqual(cdf);
    const invalid = structuredClone(entry);
    const union =
      position === 'root'
        ? invalid.$properties.choice
        : position === 'item'
          ? invalid.$properties.choice.$items!
          : invalid.$properties.choice.$fields!.choice!;
    union.members![1]!.$fields!.kind!.value = 'a';
    expect(CDFPropertySchema.safeParse(invalid.$properties.choice).success).toBe(false);
    expect(CDFComponentSchema.safeParse(invalid).success).toBe(false);
    expect(() => buildCDF([{ key: 'Example', entry: invalid }], [])).toThrow('Invalid CDF prerequisites');
  });
});

it('exports dangerous own component keys without changing document prototypes', () => {
  const entry = { $type: 'component' as const, $properties: {} };
  const cdf = buildCDF([{ key: '__proto__', entry }], [])!;
  expect(Object.hasOwn(cdf, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(cdf)).toBe(Object.prototype);
});
