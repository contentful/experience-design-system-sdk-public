import { readFileSync, writeFileSync } from 'node:fs';
import {
  cdfJsonSchema,
  previewContractSchemas,
  rewriteSchemaReferences,
  toOpenAPISchema,
  type SchemaDescriptor,
} from '@contentful/experience-design-system-types';
const path = new URL('../openapi.json', import.meta.url);
const document = JSON.parse(readFileSync(path, 'utf8')) as SchemaDescriptor;
const record = (value: unknown): SchemaDescriptor =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as SchemaDescriptor) : {};
const names = Object.fromEntries(
  Object.keys(cdfJsonSchema.definitions).map((name) => [name, 'CDF' + name[0]!.toUpperCase() + name.slice(1)]),
);
const components = record(document.components);
const schemas = { ...record(document.$defs), ...record(components.schemas) };
for (const [name, descriptor] of Object.entries(cdfJsonSchema.definitions))
  schemas[names[name]!] = rewriteSchemaReferences(descriptor as SchemaDescriptor, names, '#/definitions/', '#/$defs/');
Object.assign(schemas, previewContractSchemas);
const aliases = Object.fromEntries(Object.keys(schemas).map((key) => [key, key]));
const refresh = (schema: SchemaDescriptor): SchemaDescriptor => {
  if (Object.hasOwn(schema, '$id') || Object.hasOwn(schema, 'id')) return schema;
  const properties = record(schema.properties);
  const componentDiff = record(record(properties.components).properties);
  if (componentDiff.new && componentDiff.changed && componentDiff.removed) {
    record(componentDiff.new).items = { $ref: '#/components/schemas/ProposedComponentSummary' };
    record(record(record(componentDiff.changed).items).properties).proposed = {
      $ref: '#/components/schemas/ProposedComponentSummary',
    };
  }
  if (
    Array.isArray(record(properties.$type).enum) &&
    (record(properties.$type).enum as unknown[]).includes('component') &&
    properties.$properties
  )
    return { $ref: '#/components/schemas/CDFComponent' };
  if (properties.id && properties.contentProperties && properties.designProperties && properties.slots)
    return { $ref: '#/components/schemas/ComponentTypeSummary' };
  if (properties.breakingChanges)
    record(properties.breakingChanges).items = { $ref: '#/components/schemas/BreakingChange' };
  if (properties.current && properties.proposed && properties.hasPendingDraftChanges)
    properties.projectionDiagnostics = { type: 'array', items: { $ref: '#/components/schemas/ProjectionDiagnostic' } };
  if (properties.componentsManifest)
    properties.componentsManifest = {
      type: 'object',
      additionalProperties: { $ref: '#/components/schemas/CDFGroupOrEntry' },
    };
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    if (!schema[key]) continue;
    const map = record(schema[key]);
    for (const name of Object.keys(map)) if (typeof map[name] === 'object') map[name] = refresh(record(map[name]));
  }
  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems'])
    if (Array.isArray(schema[key])) schema[key] = (schema[key] as SchemaDescriptor[]).map(refresh);
  for (const key of [
    'items',
    'additionalProperties',
    'not',
    'contains',
    'if',
    'then',
    'else',
    'propertyNames',
    'unevaluatedProperties',
  ])
    if (schema[key] && typeof schema[key] === 'object') schema[key] = refresh(record(schema[key]));
  return rewriteSchemaReferences(schema, aliases);
};
const content = (value: unknown): void => {
  for (const media of Object.values(record(value))) {
    const row = record(media);
    if (row.schema) row.schema = refresh(record(row.schema));
  }
};
for (const pathItem of Object.values(record(document.paths))) {
  const pathRow = record(pathItem);
  for (const operation of Object.values(pathRow)) {
    const row = record(operation);
    content(record(row.requestBody).content);
    for (const response of Object.values(record(row.responses))) content(record(response).content);
    for (const parameter of [
      ...(Array.isArray(pathRow.parameters) ? pathRow.parameters : []),
      ...(Array.isArray(row.parameters) ? row.parameters : []),
    ]) {
      const item = record(parameter);
      if (item.schema) item.schema = refresh(record(item.schema));
    }
  }
}
for (const key of Object.keys(schemas))
  schemas[key] = toOpenAPISchema(
    key.startsWith('__schema') ? refresh(record(schemas[key])) : rewriteSchemaReferences(record(schemas[key]), aliases),
  );
components.schemas = schemas;
document.components = components;
delete document.$defs;
writeFileSync(path, JSON.stringify(document, null, 2) + '\n');
