import { describe, expect, it } from 'vitest';
import {
  buildCDF,
  CDF_SCHEMA_URL,
  componentDefinitionImportIssues,
  validateCDF,
  validateCDFProperty,
  type CDFComponentEntry,
  type CDFPropertyDefinition,
} from '../src/index.js';

const tag = (value: string) => ({
  $type: 'Literal' as const,
  $required: true,
  value,
  valueType: { $type: 'string' as const },
});
const union: CDFPropertyDefinition = {
  $type: 'DiscriminatedUnion',
  $category: 'content',
  discriminator: 'kind',
  members: ['a', 'b'].map((value) => ({
    $type: 'record',
    $fields: { kind: tag(value), title: { $type: 'string' } },
  })),
};

describe('complete CDF physical import validity', () => {
  it.each([
    {
      $type: 'record',
      $category: 'content',
      $fields: { child: { $type: 'record', $fields: { label: { $type: 'string' } } } },
    },
    { $type: 'record', $category: 'content', $fields: { child: { $type: 'array', $items: { $type: 'string' } } } },
    { $type: 'array', $category: 'content', $items: { $type: 'array', $items: { $type: 'number' } } },
    union,
    { $type: 'array', $category: 'content', $items: union },
    { $type: 'record', $category: 'content', $fields: { choice: union } },
    { $type: 'record', $category: 'design', $fields: { label: { $type: 'string' } } },
    { $type: 'token', $category: 'design', '$token.kind': 'invented' },
    { $type: 'token', $category: 'design', '$token.kind': 'color', $default: '' },
    {
      $type: 'record',
      $category: 'content',
      $fields: { ['__proto__']: { $type: 'string' } },
      $default: JSON.parse('{"__proto__":"retained"}'),
    },
  ] satisfies CDFPropertyDefinition[])(
    'holds an unimportable physical property %j without narrowing source grammar',
    (property) => {
      expect(validateCDFProperty(property).valid).toBe(true);
      const entry: CDFComponentEntry = { $type: 'component', $properties: { value: property } };
      const result = validateCDF({ $schema: CDF_SCHEMA_URL, Example: entry });
      expect(result.valid).toBe(false);
      expect(result.errors.some(({ path }) => path.startsWith('/Example/$properties/value'))).toBe(true);
      expect(componentDefinitionImportIssues(entry).length).toBeGreaterThan(0);
      expect(() => buildCDF([{ key: 'Example', entry }], [])).toThrow('Invalid CDF');
    },
  );

  it('rejects a conflicting in-document token kind before import', () => {
    const document = {
      $schema: CDF_SCHEMA_URL,
      Example: {
        $type: 'component',
        $properties: {
          foreground: { $type: 'token', $category: 'design', '$token.kind': 'color', $default: 'tokens.primary' },
        },
      },
      tokens: { primary: { $type: 'dimension', $value: '1px' } },
    };
    expect(validateCDF(document).valid).toBe(false);
  });

  it('rejects ordinary slot cycles while permitting an acyclic composition', () => {
    const document = {
      $schema: CDF_SCHEMA_URL,
      Example: { $type: 'component', $properties: {}, $slots: { children: { $allowedComponents: ['Example'] } } },
    };
    expect(validateCDF(document).valid).toBe(false);
    document.Example.$slots.children.$allowedComponents = ['Child'];
    expect(validateCDF({ ...document, Child: { $type: 'component', $properties: {} } }).valid).toBe(true);
  });

  it.each([
    {
      $type: 'record',
      $category: 'content',
      $fields: { ['__proto__']: { $type: 'string' }, count: { $type: 'Integer' } },
    },
    {
      $type: 'array',
      $category: 'content',
      $items: { $type: 'record', $fields: { kind: tag('a'), title: { $type: 'string' } } },
    },
    { $type: 'array', $category: 'content', $items: { $type: 'number' }, $default: [] },
    { $type: 'number', $category: 'design', $values: [0, 1], $default: 0 },
    { $type: 'boolean', $category: 'content', $values: [false], $default: false },
    { $type: 'token', $category: 'design', '$token.kind': 'color', '$token.allowed': ['color.primary'] },
  ] satisfies CDFPropertyDefinition[])('accepts an importable native property %j', (property) => {
    const entry: CDFComponentEntry = { $type: 'component', $properties: { value: property } };
    expect(componentDefinitionImportIssues(entry)).toEqual([]);
    expect(validateCDF(buildCDF([{ key: 'Example', entry }], [])).valid).toBe(true);
  });

  it.each<NonNullable<CDFComponentEntry['$slots']>>([
    { items: { $cardinality: { min: 0, max: 0, ordered: true } } },
    { items: { $cardinality: { min: 0, max: 1, ordered: true, tuplePosition: 0 } } },
    { items: { $cardinality: { min: 0, max: Number.MAX_SAFE_INTEGER + 1, ordered: true } } },
    { _: {} },
  ])('rejects unimportable slot constraints at complete validation and export: %j', ($slots) => {
    const entry: CDFComponentEntry = { $type: 'component', $properties: {}, $slots };
    expect(validateCDF({ $schema: CDF_SCHEMA_URL, Example: entry }).valid).toBe(false);
    expect(() => buildCDF([{ key: 'Example', entry }], [])).toThrow('Invalid CDF');
  });
});
