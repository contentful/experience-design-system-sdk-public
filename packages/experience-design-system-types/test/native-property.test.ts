import { describe, expect, it } from 'vitest';
import { buildCDF, validateCDF } from '../src/index.js';
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
      const cdf = buildCDF(
        [{ key: 'Example', entry: { $type: 'component', $properties: { rows: property as never } } }],
        [],
      );
      expect(validateCDF(cdf).valid).toBe(false);
    }
  });
});

it('exports dangerous own component keys without changing document prototypes', () => {
  const entry = { $type: 'component' as const, $properties: {} };
  const cdf = buildCDF([{ key: '__proto__', entry }], [])!;
  expect(Object.hasOwn(cdf, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(cdf)).toBe(Object.prototype);
});
