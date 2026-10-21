import { toJSONSchema, registry, type core } from 'zod/mini';
import { cloneJson, jsonEqual, jsonValueIssue, own } from './property-contract/json-value.js';
import { cdfJsonSchema } from './cdf/schema.js';
import { CDFComponentSchema, CDFPropertySchema, CDFSlotSchema, CDFTokenSchema } from './cdf/types.js';

export type SchemaDescriptor = Record<string, unknown>;
export type SchemaDirection = 'input' | 'output';
const pointer = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');
const unpointer = (value: string) => value.replace(/~1/g, '/').replace(/~0/g, '~');
const schemaLists = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const schemaChildren = new Set([
  'items',
  'additionalProperties',
  'additionalItems',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
]);

/** Only schema reference positions are rewritten; defaults and examples remain data. */
export function rewriteSchemaReferences(
  input: SchemaDescriptor,
  aliases: Readonly<Record<string, string>>,
  from = '#/$defs/',
  to = '#/components/schemas/',
): SchemaDescriptor {
  const root = cloneJson(input);
  const rewrite = (value: unknown): unknown => {
    if (typeof value !== 'string' || !value.startsWith(from)) return value;
    const suffix = value.slice(from.length).split('/');
    const name = unpointer(suffix[0]!);
    if (!own(aliases, name)) return value;
    return to + pointer(aliases[name]!) + (suffix.length > 1 ? '/' + suffix.slice(1).join('/') : '');
  };
  const visit = (schema: unknown, isRoot = false): void => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
    const row = schema as SchemaDescriptor;
    if (!isRoot && (own(row, '$id') || own(row, 'id'))) return;
    if (own(row, '$ref')) row.$ref = rewrite(row.$ref);
    const discriminator = row.discriminator as { mapping?: Record<string, unknown> } | undefined;
    if (discriminator?.mapping)
      for (const key of Object.keys(discriminator.mapping))
        discriminator.mapping[key] = rewrite(discriminator.mapping[key]);
    for (const [key, value] of Object.entries(row)) {
      if (schemaMaps.has(key) && value && typeof value === 'object')
        for (const child of Object.values(value)) visit(child);
      else if (schemaLists.has(key) && Array.isArray(value)) for (const child of value) visit(child);
      else if (schemaChildren.has(key)) {
        if (Array.isArray(value)) value.forEach((child) => visit(child));
        else visit(value);
      }
    }
  };
  visit(root, true);
  return root;
}

/** Translate schema keywords for OpenAPI while keeping example/default data unchanged. */
export function toOpenAPISchema(input: SchemaDescriptor): SchemaDescriptor {
  const root = cloneJson(input);
  const visit = (value: unknown, isRoot = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const schema = value as SchemaDescriptor;
    if (!isRoot && (own(schema, '$id') || own(schema, 'id'))) return;
    if (own(schema, 'const')) {
      schema.enum = [schema.const];
      delete schema.const;
    }
    if (Array.isArray(schema.type)) {
      const types = schema.type as string[];
      const concrete = types.filter((type) => type !== 'null');
      if (types.includes('null')) schema.nullable = true;
      if (concrete.length === 1) schema.type = concrete[0];
      else {
        delete schema.type;
        schema.anyOf = concrete.map((type) => ({ type }));
      }
    } else if (schema.type === 'null') {
      schema.type = 'string';
      schema.nullable = true;
      schema.enum = [null];
    }
    for (const [key, child] of Object.entries(schema)) {
      if (schemaMaps.has(key) && child && typeof child === 'object')
        for (const nested of Object.values(child)) visit(nested);
      else if (schemaLists.has(key) && Array.isArray(child)) child.forEach((nested) => visit(nested));
      else if (schemaChildren.has(key)) {
        if (Array.isArray(child)) child.forEach((nested) => visit(nested));
        else visit(child);
      }
    }
  };
  visit(root, true);
  return root;
}

function legalName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  const encoded = Array.from(name)
    .map((character) => character.codePointAt(0)!.toString(16))
    .join('_');
  return 'Schema_' + encoded;
}
type Registration = { name: string; input: SchemaDescriptor; output: SchemaDescriptor };

/** Registrations and generated descriptor copies belong to one invocation. */
export class SchemaExportScope {
  private readonly nodes = new Map<core.$ZodType, Registration>();
  private readonly definitions = new Map<string, SchemaDescriptor>();
  private readonly aliases: Record<string, string> = Object.create(null);

  register(
    schema: core.$ZodType,
    name: string,
    descriptor: SchemaDescriptor | { input: SchemaDescriptor; output: SchemaDescriptor },
  ): string {
    if (!name || jsonValueIssue(descriptor)) throw new Error('Invalid schema registration');
    const alias = legalName(name);
    const directed =
      own(descriptor, 'input') && own(descriptor, 'output')
        ? (descriptor as { input: SchemaDescriptor; output: SchemaDescriptor })
        : { input: descriptor as SchemaDescriptor, output: descriptor as SchemaDescriptor };
    const previous = this.nodes.get(schema);
    if (
      previous &&
      (previous.name !== alias ||
        !jsonEqual(previous.input, directed.input) ||
        !jsonEqual(previous.output, directed.output))
    )
      throw new Error('Conflicting schema registration');
    const directedExisting = [...this.nodes.values()].find((entry) => entry.name === alias);
    if (directedExisting && !jsonEqual(directedExisting.input, directed.input))
      throw new Error('Conflicting exported schema direction');
    const existing = this.definitions.get(alias);
    if (existing && !jsonEqual(existing, directed.output)) throw new Error('Conflicting exported schema name');
    this.aliases[name] = alias;
    this.nodes.set(schema, { name: alias, input: cloneJson(directed.input), output: cloneJson(directed.output) });
    this.definitions.set(alias, cloneJson(directed.output));
    return alias;
  }

  addDefinition(name: string, descriptor: SchemaDescriptor): void {
    if (jsonValueIssue(descriptor)) throw new Error('Invalid schema descriptor');
    const alias = legalName(name);
    const previous = this.definitions.get(alias);
    if (previous && !jsonEqual(previous, descriptor)) throw new Error('Conflicting exported schema name');
    this.aliases[name] = alias;
    this.definitions.set(alias, cloneJson(descriptor));
  }

  convert(
    schema: core.$ZodType,
    options: { direction?: SchemaDirection; target?: 'draft-7' | 'openapi-3.0' } = {},
  ): SchemaDescriptor {
    const seen = new Set<object>();
    const inspect = (value: unknown): void => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if ('_zod' in value) {
        const node = value as core.$ZodType;
        if (this.nodes.has(node)) return;
        const def = node._zod.def as unknown as Record<string, unknown>;
        if (
          [
            'custom',
            'transform',
            'date',
            'bigint',
            'symbol',
            'undefined',
            'nan',
            'map',
            'set',
            'file',
            'promise',
            'function',
          ].includes(String(def.type))
        )
          throw new Error('Unsupported schema requires an explicit scoped descriptor');
        if (def.type === 'lazy') inspect((def.getter as () => unknown)());
        for (const member of Object.values(def)) inspect(member);
      } else for (const member of Object.values(value)) inspect(member);
    };
    inspect(schema);
    const direction = options.direction ?? 'output';
    const result = toJSONSchema(schema, {
      target: options.target ?? 'draft-7',
      io: direction,
      metadata: registry(),
      unrepresentable: 'any',
      reused: 'ref',
      override: ({ zodSchema, jsonSchema }) => {
        const registered = this.nodes.get(zodSchema);
        if (registered) {
          for (const key of Object.keys(jsonSchema)) delete (jsonSchema as Record<string, unknown>)[key];
          Object.assign(jsonSchema, { $ref: '#/$defs/' + pointer(registered.name) });
        }
      },
    }) as SchemaDescriptor;
    // The converter attaches non-enumerable standard-schema helpers to its output.
    const document = JSON.parse(JSON.stringify(result)) as SchemaDescriptor;
    const definitions: SchemaDescriptor = cloneJson((document.definitions ?? document.$defs ?? {}) as SchemaDescriptor);
    delete document.definitions;
    for (const [name, descriptor] of this.definitions) {
      if (own(definitions, name) && !jsonEqual(definitions[name], descriptor))
        throw new Error('Generated schema name collision');
      const registered = [...this.nodes.values()].find((entry) => entry.name === name);
      Object.defineProperty(definitions, name, {
        value: cloneJson(registered?.[direction] ?? descriptor),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    document.$defs = definitions;
    const extractedNames = Object.keys(definitions);
    const extractedAliases = Object.fromEntries(extractedNames.map((name) => [name, name]));
    const rewritten = rewriteSchemaReferences(document, extractedAliases, '#/definitions/', '#/$defs/');
    return options.target === 'openapi-3.0' ? toOpenAPISchema(rewritten) : rewritten;
  }

  openAPI(
    schemas: Readonly<Record<string, core.$ZodType>>,
    options: { direction?: SchemaDirection; existingNames?: readonly string[] } = {},
  ): { schemas: Record<string, SchemaDescriptor>; aliases: Record<string, string> } {
    const result: Record<string, SchemaDescriptor> = Object.create(null);
    const aliases: Record<string, string> = Object.create(null);
    const reserved = new Set(options.existingNames ?? []);
    for (const name of Object.keys(schemas)) {
      const alias = legalName(name);
      if (
        reserved.has(alias) ||
        Object.values(aliases).includes(alias) ||
        (this.definitions.has(alias) && this.nodes.get(schemas[name]!)?.name !== alias)
      )
        throw new Error('OpenAPI schema alias collision');
      aliases[name] = alias;
    }
    for (const name of Object.keys(schemas)) {
      const alias = aliases[name]!;
      let document = this.convert(schemas[name]!, { direction: options.direction, target: 'openapi-3.0' });
      const definitions = document.$defs as Record<string, SchemaDescriptor>;
      delete document.$defs;
      delete document.$schema;
      if (this.nodes.get(schemas[name]!)?.name === alias) document = cloneJson(definitions[alias]!);
      const scoped = Object.fromEntries(
        Object.keys(definitions).map((key) => [key, this.definitions.has(key) ? key : alias + '_' + legalName(key)]),
      );
      const allAliases = { ...this.aliases, ...aliases, ...scoped };
      result[alias] = rewriteSchemaReferences(document, allAliases);
      for (const [key, definition] of Object.entries(definitions)) {
        const exported = scoped[key]!;
        const rewritten = rewriteSchemaReferences(definition, allAliases);
        if (
          reserved.has(exported) ||
          (own(result, exported) && !jsonEqual(result[exported], rewritten)) ||
          (Object.values(aliases).includes(exported) && exported !== alias && !this.definitions.has(exported))
        )
          throw new Error('OpenAPI definition collision');
        result[exported] = rewritten;
      }
    }
    return { schemas: cloneJson(result), aliases: cloneJson(aliases) };
  }
}

export function createCDFSchemaExportScope(): SchemaExportScope {
  const scope = new SchemaExportScope();
  const names = Object.fromEntries(
    Object.keys(cdfJsonSchema.definitions).map((key) => [key, 'CDF' + key[0]!.toUpperCase() + key.slice(1)]),
  );
  for (const [name, descriptor] of Object.entries(cdfJsonSchema.definitions))
    scope.addDefinition(
      names[name]!,
      rewriteSchemaReferences(descriptor as unknown as SchemaDescriptor, names, '#/definitions/', '#/$defs/'),
    );
  for (const [schema, name] of [
    [CDFComponentSchema, 'component'],
    [CDFPropertySchema, 'property'],
    [CDFSlotSchema, 'slot'],
    [CDFTokenSchema, 'token'],
  ] as const)
    scope.register(
      schema,
      names[name]!,
      rewriteSchemaReferences(
        cdfJsonSchema.definitions[name] as unknown as SchemaDescriptor,
        names,
        '#/definitions/',
        '#/$defs/',
      ),
    );
  return scope;
}
