import { expect, it } from 'vitest';
import { buildCDF, buildFilteredCDF, CDFComponentSchema, validateCDF } from '../src/index.js';
import * as z from 'zod/mini';
import {
  createCDFSchemaExportScope,
  SchemaExportScope,
  rewriteSchemaReferences,
  sanitizeBreakingChanges,
  SLOT_BREAKING_REASONS,
  previewContractSchemas,
} from '../src/index.js';

it('keeps complete target component definitions distinct from source descriptors in preview exports', () => {
  expect(previewContractSchemas.ComponentTypeSummary).toHaveProperty('properties.targetDefinition', {});
  expect(previewContractSchemas.ComponentTypeSummary).toHaveProperty('properties.sourceDefinition', {});
});

it('conserves recursive own definitions and both slot requirement states through actual build/filter/parse', () => {
  const entry = {
    $type: 'component' as const,
    $properties: JSON.parse(
      '{"__proto__":{"$type":"record","$category":"content","$required":false,"$fields":{"a/b~c":{"$type":"number","$required":true}},"$default":{"a/b~c":0}}}',
    ),
    $slots: { first: { $required: false }, second: { $required: true } },
  };
  const cdf = buildCDF([{ key: 'constructor', entry }], [])!;
  expect(cdf.constructor).toEqual(entry);
  const filtered = buildFilteredCDF(cdf, new Set(['constructor']), new Set())!;
  expect(filtered.constructor).toEqual(entry);
  expect(CDFComponentSchema.parse(entry).$properties).toHaveProperty('__proto__');
  expect(validateCDF(filtered).valid).toBe(true);
});

it('uses one own-ID breaking vocabulary without clearing top-level classification or evaluating unsafe data', () => {
  expect(
    sanitizeBreakingChanges(SLOT_BREAKING_REASONS.map((reason) => ({ slotId: '__proto__', reason }))),
  ).toHaveLength(SLOT_BREAKING_REASONS.length);
  for (const value of [
    { propertyId: 'a', slotId: 'b', reason: 'removed' },
    { slotId: '', reason: 'slot_became_required' },
    { slotId: 'a', reason: 'removed' },
    { reason: 'slot_added_required' },
    Object.create({ slotId: 'a', reason: 'slot_added_required' }),
  ])
    expect(sanitizeBreakingChanges([value])).toEqual([]);
});

it('preserves cardinality narrowing through the shared preview contract', () => {
  const change = { slotId: 'items', reason: 'slot_cardinality_narrowed' };
  expect(sanitizeBreakingChanges([change])).toEqual([change]);
});

it('exports scoped composed schemas with direction/default/null fidelity and independent documents', () => {
  const scope = createCDFSchemaExportScope();
  const input = z.object({
    entry: CDFComponentSchema,
    count: z._default(z.number(), 0),
    nullable: z.nullable(CDFComponentSchema),
  });
  const request = scope.convert(input, { direction: 'input' });
  const response = scope.convert(input, { direction: 'output' });
  expect(request.required).not.toContain('count');
  expect(response.required).toContain('count');
  expect(JSON.stringify(request)).toContain('CDFComponent');
  expect(JSON.stringify(response)).toContain('null');
  const first = scope.openAPI({ 'a/b~c': input });
  const second = scope.openAPI({ 'a/b~c': input });
  const alias = first.aliases['a/b~c']!;
  first.schemas[alias]!.description = 'changed';
  expect(second.schemas[alias]!.description).toBeUndefined();
  expect(() => scope.openAPI({ 'a/b~c': input }, { existingNames: [alias] })).toThrow('collision');
});

it('rejects unsupported reused schemas and unequal registrations rather than laundering references', () => {
  const scope = new SchemaExportScope();
  const custom = z.custom(() => true);
  expect(() => scope.convert(z.object({ first: custom, second: custom }))).toThrow('Unsupported schema');
  scope.register(custom, 'Opaque', { type: 'string' });
  expect(() => scope.register(custom, 'Opaque', { type: 'number' })).toThrow('Conflicting');
  expect(scope.convert(z.array(custom))).toHaveProperty('$defs.Opaque');
});

it('rewrites scoped schema pointers and discriminator mappings while retaining ref-looking data and local resources', () => {
  const original = {
    properties: { item: { $ref: '#/$defs/a~1b~0c' }, local: { $id: 'local', $ref: '#/$defs/a~1b~0c' } },
    discriminator: { mapping: { choice: '#/$defs/a~1b~0c' } },
    default: { $ref: '#/$defs/a~1b~0c' },
    examples: [{ $ref: '#/$defs/a~1b~0c' }],
    const: { $ref: '#/$defs/a~1b~0c' },
    'x-data': { $ref: '#/$defs/a~1b~0c' },
  };
  const rewritten = rewriteSchemaReferences(original, { 'a/b~c': 'Safe' });
  expect(rewritten.properties).toEqual({
    item: { $ref: '#/components/schemas/Safe' },
    local: original.properties.local,
  });
  expect(rewritten.default).toEqual(original.default);
  expect(rewritten.examples).toEqual(original.examples);
  expect(rewritten.const).toEqual(original.const);
  expect(rewritten['x-data']).toEqual(original['x-data']);
  expect(rewritten.discriminator).toEqual({ mapping: { choice: '#/components/schemas/Safe' } });
});

it('rejects duplicate and group/leaf/component/token collisions before emitting a document', () => {
  const entry = { $type: 'component' as const, $properties: {} };
  expect(() =>
    buildCDF(
      [
        { key: 'value', entry },
        { key: 'value', entry },
      ],
      [],
    ),
  ).toThrow('collision');
  expect(() =>
    buildCDF(
      [
        { key: 'group', entry },
        { key: 'group.child', entry },
      ],
      [],
    ),
  ).toThrow('collision');
  expect(() => buildCDF([{ key: 'value', entry }], [{ path: 'value', entry: { $type: 'number', $value: 0 } }])).toThrow(
    'collision',
  );
  expect(() => buildCDF([{ key: '$schema', entry }], [])).toThrow('collision');
  expect(buildFilteredCDF(buildCDF([{ key: 'value', entry }], [])!, new Set(['missing']), new Set())).toBeUndefined();
});

it('keeps valid breaking details next to malformed and accessor entries without running getters', () => {
  const details: unknown[] = [
    { slotId: 'one', reason: 'slot_became_required' },
    { propertyId: 'bad', slotId: 'bad', reason: 'removed' },
    { slotId: 'two', reason: 'slot_added_required' },
  ];
  const get = () => {
    throw new Error('Getter evaluated');
  };
  Object.defineProperty(details, '1', { get, enumerable: true, configurable: true });
  expect(sanitizeBreakingChanges(details)).toEqual([
    { slotId: 'one', reason: 'slot_became_required' },
    { slotId: 'two', reason: 'slot_added_required' },
  ]);
});

it('clones token values and retains selected ancestor group descriptions', () => {
  const token = { $type: 'number' as const, $value: 0 };
  const entry = { $type: 'component' as const, $properties: {} };
  const first = buildCDF([{ key: 'group.value', entry }], [{ path: 'tokens.value', entry: token }])!;
  token.$value = 1;
  expect((first.tokens as Record<string, unknown>).value).toEqual({ $type: 'number', $value: 0 });
  (first.group as Record<string, unknown>).$description = 'Source group';
  expect(
    (buildFilteredCDF(first, new Set(['group.value']), new Set())!.group as Record<string, unknown>).$description,
  ).toBe('Source group');
});

it('supports canonical direct aliases and independent reused schemas in one OpenAPI invocation', () => {
  const scope = createCDFSchemaExportScope();
  const reused = z.object({ value: z.number() });
  const result = scope.openAPI({
    CDFComponent: CDFComponentSchema,
    Alias: CDFComponentSchema,
    First: z.object({ one: reused, two: reused }),
    Second: z.object({ one: z.array(reused), two: reused }),
  });
  expect(result.schemas.CDFComponent!.properties).toHaveProperty('$properties');
  expect(result.schemas.Alias!.$ref).toBe('#/components/schemas/CDFComponent');
  expect(JSON.stringify(result.schemas.First)).toContain('First_');
  expect(JSON.stringify(result.schemas.Second)).toContain('Second_');
  const custom = z.custom(() => true);
  scope.register(custom, 'Directed', { input: { type: 'number' }, output: { type: 'string' } });
  expect((scope.convert(custom, { direction: 'input' }).$defs as Record<string, unknown>).Directed).toEqual({
    type: 'number',
  });
  expect(() =>
    scope.register(
      z.custom(() => true),
      'Directed',
      { input: { type: 'boolean' }, output: { type: 'string' } },
    ),
  ).toThrow('direction');
});

it('exports structural schemas with refinements without treating checks as opaque schema nodes', () => {
  const scope = createCDFSchemaExportScope();
  const refined = z.strictObject({ name: z.string() }).check(z.refine((value) => value.name.length > 0));
  const document = scope.convert(refined);
  expect(document).toMatchObject({ type: 'object', required: ['name'] });
  const properties = document.properties as Record<string, { $ref: string }>;
  const definitions = document.$defs as Record<string, unknown>;
  expect(definitions[properties.name!.$ref.slice('#/$defs/'.length)]).toEqual({ type: 'string' });
});
