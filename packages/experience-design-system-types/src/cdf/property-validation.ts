import type { CDFFieldDefinition } from './types.js';
import { CDF_FIELD_TYPES, CDF_PROPERTY_CATEGORIES } from './vocabularies.js';
import { childPath, cloneJson, jsonValueIssue, own, type PropertyIssue } from '../property-contract/json-value.js';
import { validateTargetDefinition, type TargetDefinition } from '../property-contract/target-definition.js';
import { SourceInputAssociationSchema } from '../source-input-association.js';
import { finiteValuesIssue } from './finite-values.js';

const targetTypes = {
  string: 'String',
  number: 'Number',
  boolean: 'Boolean',
  array: 'Array',
  record: 'Record',
  richtext: 'String',
  media: 'String',
  link: 'String',
  token: 'String',
  Integer: 'Integer',
  DateTime: 'DateTime',
  Literal: 'Literal',
  RichText: 'RichText',
  JSON: 'JSON',
  ResourceLink: 'ResourceLink',
  DiscriminatedUnion: 'DiscriminatedUnion',
} as const;
export function cdfToTarget(d: CDFFieldDefinition): TargetDefinition {
  const t: TargetDefinition = { type: targetTypes[d.$type] };
  if (own(d, '$required')) t.required = d.$required;
  if (own(d, '$description')) t.description = d.$description;
  if (own(d, '$default')) t.defaultValue = d.$default;
  if (d.$values) t.values = d.$values;
  if (own(d, 'value')) t.value = d.value;
  if (d.valueType) t.valueType = cdfToTarget(d.valueType);
  if (d.discriminator !== undefined) t.discriminator = d.discriminator;
  if (d.members) t.members = d.members.map(cdfToTarget);
  if (d.allowedResources) t.allowedResources = d.allowedResources;
  if (d.$items) t.items = cdfToTarget(d.$items);
  if (d.$fields)
    t.fields = Object.fromEntries(Object.entries(d.$fields).map(([key, field]) => [key, cdfToTarget(field)]));
  return t;
}

/** Decode complete target metadata without narrowing it to a type name. */
export function targetToCDF(d: TargetDefinition): CDFFieldDefinition {
  const types = {
    String: 'string',
    Number: 'number',
    Boolean: 'boolean',
    Array: 'array',
    Record: 'record',
    Integer: 'Integer',
    DateTime: 'DateTime',
    Literal: 'Literal',
    RichText: 'RichText',
    JSON: 'JSON',
    ResourceLink: 'ResourceLink',
    DiscriminatedUnion: 'DiscriminatedUnion',
  } as const;
  const field: CDFFieldDefinition = { $type: types[d.type] };
  if (own(d, 'required')) field.$required = d.required;
  if (own(d, 'description')) field.$description = d.description;
  if (own(d, 'defaultValue')) field.$default = cloneJson(d.defaultValue!);
  if (d.values) field.$values = cloneJson(d.values);
  if (d.items) field.$items = targetToCDF(d.items);
  if (d.fields)
    field.$fields = Object.fromEntries(Object.entries(d.fields).map(([key, child]) => [key, targetToCDF(child)]));
  if (own(d, 'value')) field.value = cloneJson(d.value!);
  if (d.valueType) field.valueType = targetToCDF(d.valueType);
  if (d.discriminator !== undefined) field.discriminator = d.discriminator;
  if (d.members) field.members = d.members.map(targetToCDF);
  if (d.allowedResources) field.allowedResources = cloneJson(d.allowedResources);
  return field;
}

/** All recursive grammar children retain their exact paths, including exclusive members. */
export function cdfDefinitionChildren(definition: CDFFieldDefinition): Array<{
  definition: CDFFieldDefinition;
  path: string;
}> {
  return [
    ...(definition.$items ? [{ definition: definition.$items, path: '/$items' }] : []),
    ...(definition.valueType ? [{ definition: definition.valueType, path: '/valueType' }] : []),
    ...Object.entries(definition.$fields ?? {}).map(([key, field]) => ({
      definition: field,
      path: childPath('/$fields', key),
    })),
    ...(definition.members ?? []).map((member, index) => ({ definition: member, path: '/members/' + index })),
  ];
}
export function containsCDFDefinitionType(definition: CDFFieldDefinition, type: string): boolean {
  return (
    definition.$type === type ||
    cdfDefinitionChildren(definition).some((child) => containsCDFDefinitionType(child.definition, type))
  );
}
export function validateCDFProperty(
  input: unknown,
  requireCategory = true,
): { valid: boolean; issues: PropertyIssue[] } {
  const unsafe = jsonValueIssue(input);
  if (unsafe) return { valid: false, issues: [unsafe] };
  const issues: PropertyIssue[] = [];
  const walk = (value: unknown, path: string, root: boolean, depth: number): void => {
    if (depth > 64 || !value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push({ path, message: 'Expected bounded property definition' });
      return;
    }
    const d = value as CDFFieldDefinition;
    const add = (key: string, message: string) => issues.push({ path: childPath(path, key), message });
    if (!CDF_FIELD_TYPES.includes(d.$type)) {
      add('$type', 'Unknown CDF type');
      return;
    }
    if ((root && requireCategory) || own(d, '$category'))
      if (!CDF_PROPERTY_CATEGORIES.includes(d.$category!)) add('$category', 'Unknown category');
    const allowed = new Set(['$type', '$category', '$description', '$required', '$default', '$values']);
    if (root) allowed.add('$sourceInput');
    if (
      own(d, '$sourceInput') &&
      !SourceInputAssociationSchema.safeParse((d as { $sourceInput?: unknown }).$sourceInput).success
    )
      add('$sourceInput', 'Invalid source input association');
    if (d.$type === 'array') allowed.add('$items');
    if (d.$type === 'record') allowed.add('$fields');
    if (
      ['Integer', 'DateTime', 'Literal', 'RichText', 'JSON', 'ResourceLink', 'DiscriminatedUnion'].includes(d.$type) &&
      d.$category !== undefined &&
      d.$category !== 'content'
    )
      add('$category', 'Richer representations require content category');
    if (d.$type === 'Literal') {
      allowed.add('value');
      allowed.add('valueType');
      walk(d.valueType, childPath(path, 'valueType'), false, depth + 1);
    }
    if (d.$type === 'ResourceLink') allowed.add('allowedResources');
    if (d.$type === 'DiscriminatedUnion') {
      allowed.add('discriminator');
      allowed.add('members');
      if (!Array.isArray(d.members)) add('members', 'Expected complete union members');
      else
        d.members.forEach((member, index) =>
          walk(member, childPath(childPath(path, 'members'), index), false, depth + 1),
        );
    }
    if (d.$type === 'token') {
      allowed.add('$token.kind');
      allowed.add('$token.allowed');
    }
    for (const key of Object.keys(d)) if (!allowed.has(key)) add(key, 'Unexpected property metadata');
    if (own(d, '$description') && typeof d.$description !== 'string') add('$description', 'Expected string');
    if (own(d, '$values')) {
      if (!Array.isArray(d.$values)) add('$values', 'Expected array');
      else {
        const issue = finiteValuesIssue(d.$type, d.$values);
        if (issue)
          issues.push({
            path:
              issue.index === undefined
                ? childPath(path, '$values')
                : childPath(childPath(path, '$values'), issue.index),
            message: issue.message,
          });
      }
    }
    if (own(d, '$required') && typeof d.$required !== 'boolean') add('$required', 'Expected boolean');
    if (own(d, '$token.kind') && typeof d['$token.kind'] !== 'string') add('$token.kind', 'Expected string');
    if (
      own(d, '$token.allowed') &&
      (!Array.isArray(d['$token.allowed']) || !d['$token.allowed']!.every((v) => typeof v === 'string'))
    )
      add('$token.allowed', 'Expected string paths');
    if (d.$type === 'array') walk(d.$items, childPath(path, '$items'), false, depth + 1);
    if (d.$type === 'record') {
      if (
        !d.$fields ||
        typeof d.$fields !== 'object' ||
        Array.isArray(d.$fields) ||
        Object.keys(d.$fields).length === 0
      )
        add('$fields', 'Expected nonempty field dictionary');
      else
        for (const [key, field] of Object.entries(d.$fields))
          walk(field, childPath(childPath(path, '$fields'), key), false, depth + 1);
    }
  };
  walk(input, '', true, 0);
  if (!issues.length) {
    for (const issue of validateTargetDefinition(cdfToTarget(input as CDFFieldDefinition)).issues)
      issues.push({
        path: issue.path
          .replace(/\/defaultValue(?=\/|$)/g, '/$default')
          .replace(/\/items(?=\/|$)/g, '/$items')
          .replace(/\/fields(?=\/|$)/g, '/$fields')
          .replace(/\/values(?=\/|$)/g, '/$values'),
        message: issue.message,
      });
  }
  return { valid: !issues.length, issues };
}
