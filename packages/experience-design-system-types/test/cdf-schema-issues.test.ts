import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import {
  CDF_SCHEMA_URL,
  CDFComponentSchema,
  CDFPropertySchema,
  CDFSlotSchema,
  cdfJsonSchema,
  createCDFSchemaExportScope,
  rewriteSchemaReferences,
  validateCDF,
  validateCDFProperty,
} from '../src/index.js';

const label = { $type: 'string', $category: 'content' };
const component = (overrides: Record<string, unknown> = {}) => ({
  $type: 'component',
  $properties: { label },
  $slots: { children: { $allowedComponents: ['Button'] } },
  ...overrides,
});
const issuesOf = (schema: z.ZodMiniType, value: unknown) =>
  (schema.safeParse(value).error?.issues ?? []).map(({ path, message }) => ({ path, message }));
const fileErrors = (entry: unknown) =>
  validateCDF({ $schema: CDF_SCHEMA_URL, Card: entry }).errors.map(({ path, message }) => ({
    path: path.replace(/^\/Card/, ''),
    message,
  }));

describe('CDFPropertySchema issues', () => {
  it('accepts valid properties unchanged', () => {
    const property = { ...label, $values: ['a', 'b'], $default: 'a' };
    const result = CDFPropertySchema.safeParse(property);
    expect(result.success).toBe(true);
    expect(result.data).toBe(property);
  });

  it('reports an unknown $type at its field', () => {
    expect(issuesOf(CDFPropertySchema, { $type: 'widget', $category: 'content' })).toEqual([
      { path: ['$type'], message: 'Unknown CDF type' },
    ]);
  });

  it('reports an out-of-domain $default with the validator message', () => {
    const property = { ...label, $values: ['a', 'b'], $default: 'c' };
    const expected = validateCDFProperty(property).issues;
    expect(expected.length).toBeGreaterThan(0);
    expect(issuesOf(CDFPropertySchema, property)).toEqual(
      expected.map(({ path, message }) => ({ path: path.split('/').slice(1), message })),
    );
    expect(issuesOf(CDFPropertySchema, property)[0]!.path[0]).toBe('$default');
  });

  it('reports every field error with array indices as numbers', () => {
    expect(
      issuesOf(CDFPropertySchema, { ...label, $values: ['a', 1], $required: 'yes', extra: true }).map(
        ({ path }) => path,
      ),
    ).toEqual(expect.arrayContaining([['extra'], ['$values', 1], ['$required']]));
  });
});

describe('CDFComponentSchema issues', () => {
  it('accepts valid components unchanged', () => {
    const entry = component();
    const result = CDFComponentSchema.safeParse(entry);
    expect(result.success).toBe(true);
    expect(result.data).toBe(entry);
  });

  it('reports an empty slot id at the slot', () => {
    expect(issuesOf(CDFComponentSchema, component({ $slots: { ' ': {} } }))).toEqual([
      { path: ['$slots', ' '], message: 'Slot id must be a non-empty string' },
    ]);
  });

  it('reports a bad property type with the same errors as validateCDF', () => {
    const entry = component({ $properties: { label: { $type: 'widget', $category: 'content' } } });
    const expected = fileErrors(entry);
    expect(expected).toContainEqual(expect.objectContaining({ path: '/$properties/label/$type' }));
    expect(issuesOf(CDFComponentSchema, entry)).toEqual(
      expected.map(({ path, message }) => ({ path: path.split('/').slice(1), message })),
    );
  });

  it('reports an unknown component $type', () => {
    expect(issuesOf(CDFComponentSchema, component({ $type: 'widget' }))).toContainEqual({
      path: ['$type'],
      message: 'must be equal to constant',
    });
  });

  it('reports property errors the JSON Schema admits', () => {
    const entry = component({ $properties: { label: { ...label, $values: ['a', 'b'], $default: 'c' } } });
    const expected = validateCDFProperty(entry.$properties.label).issues;
    expect(issuesOf(CDFComponentSchema, entry)).toEqual(
      expected.map(({ path, message }) => ({ path: ['$properties', 'label', ...path.split('/').slice(1)], message })),
    );
  });

  it('reports slot cardinality outside the JSON Schema', () => {
    const issues = issuesOf(
      CDFComponentSchema,
      component({ $slots: { items: { $cardinality: { min: 2, max: 1, ordered: true } } } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['$slots', 'items', '$cardinality']);
  });

  it('rejects non-object input with one root issue', () => {
    expect(issuesOf(CDFComponentSchema, 'Card')).toEqual([{ path: [], message: 'Expected component object' }]);
    expect(issuesOf(CDFComponentSchema, [])).toEqual([{ path: [], message: 'Expected component object' }]);
  });

  it('places field issues under the parent path', () => {
    const result = z
      .object({ components: z.array(CDFComponentSchema) })
      .safeParse({ components: [component(), component({ $slots: { '': {} } })] });
    expect(result.error?.issues.map(({ path }) => path)).toEqual([['components', 1, '$slots', '']]);
  });

  it('surfaces field issues through a union when only the component branch applies', () => {
    const result = z.union([z.null(), CDFComponentSchema]).safeParse(component({ $slots: { ' ': {} } }));
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['$slots', ' '], message: 'Slot id must be a non-empty string' }),
    ]);
  });
});

describe('validateCDF component errors', () => {
  it('lists the component field errors instead of a generic message', () => {
    expect(fileErrors(component({ $slots: { ' ': {} } }))).toEqual([
      { path: '/$slots/ ', message: 'Slot id must be a non-empty string' },
    ]);
  });
});

describe('CDF JSON Schema export', () => {
  const names = Object.fromEntries(
    Object.keys(cdfJsonSchema.definitions).map((key) => [key, 'CDF' + key[0]!.toUpperCase() + key.slice(1)]),
  );
  it.each([
    [CDFComponentSchema, 'component'],
    [CDFPropertySchema, 'property'],
    [CDFSlotSchema, 'slot'],
  ] as const)('exports %#: the %s definition', (schema, name) => {
    const document = createCDFSchemaExportScope().convert(z.object({ value: schema }));
    expect(document).toHaveProperty('properties.value', { $ref: `#/$defs/${names[name]}` });
    expect((document.$defs as Record<string, unknown>)[names[name]!]).toEqual(
      rewriteSchemaReferences(
        cdfJsonSchema.definitions[name] as unknown as Record<string, unknown>,
        names,
        '#/definitions/',
        '#/$defs/',
      ),
    );
  });
});
