import { childPath, jsonEqual, jsonValueIssue, own, type JsonValue, type PropertyIssue } from './json-value.js';
import { isDateTimeValue } from './date-time-value.js';
import { discriminatedUnionIssues, matchingDiscriminatedUnionMember } from './discriminated-union.js';

export const TARGET_PROPERTY_TYPES = [
  'String',
  'Number',
  'Boolean',
  'Array',
  'Record',
  'Integer',
  'DateTime',
  'RichText',
  'JSON',
  'ResourceLink',
  'Literal',
  'DiscriminatedUnion',
] as const;
export type TargetPropertyType = (typeof TARGET_PROPERTY_TYPES)[number];
export const SAME_SPACE_RESOURCE_SOURCE = 'crn:contentful:::content:spaces/$self/environments/$self';
export type AllowedResourceDefinition =
  | { type: 'Contentful:Entry'; source: typeof SAME_SPACE_RESOURCE_SOURCE; allowedTypes: string[] }
  | { type: 'Contentful:Asset'; source: typeof SAME_SPACE_RESOURCE_SOURCE };
export interface TargetDefinition {
  type: TargetPropertyType;
  id?: string;
  name?: string;
  description?: string;
  required?: boolean;
  values?: JsonValue[];
  defaultValue?: JsonValue;
  items?: TargetDefinition;
  fields?: Record<string, TargetDefinition>;
  allowedResources?: AllowedResourceDefinition[];
  value?: JsonValue;
  valueType?: TargetDefinition;
  discriminator?: string;
  members?: TargetDefinition[];
}
export interface DefinitionValidation {
  valid: boolean;
  issues: PropertyIssue[];
}

export function containsTargetDefinitionType(definition: TargetDefinition, type: TargetPropertyType): boolean {
  return (
    definition.type === type ||
    (definition.items !== undefined && containsTargetDefinitionType(definition.items, type)) ||
    (definition.valueType !== undefined && containsTargetDefinitionType(definition.valueType, type)) ||
    Object.values(definition.fields ?? {}).some((field) => containsTargetDefinitionType(field, type)) ||
    (definition.members ?? []).some((member) => containsTargetDefinitionType(member, type))
  );
}

export function validateTargetValue(definition: TargetDefinition, value: JsonValue, path = ''): PropertyIssue[] {
  const fail = (message: string): PropertyIssue[] => [{ path, message }];
  const { type } = definition;
  if (definition.values && !definition.values.some((allowed) => jsonEqual(allowed, value)))
    return fail('Value outside declared domain');
  if (type === 'String' || type === 'DateTime') {
    if (typeof value !== 'string') return fail('Expected string');
    if (type === 'DateTime' && !isDateTimeValue(value)) return fail('Expected timezone-qualified ISO datetime');
  } else if (type === 'Number' || type === 'Integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'Integer' && !Number.isSafeInteger(value)))
      return fail(type === 'Integer' ? 'Expected safe integer' : 'Expected finite number');
  } else if (type === 'Boolean') {
    if (typeof value !== 'boolean') return fail('Expected boolean');
  } else if (type === 'Array') {
    if (!Array.isArray(value)) return fail('Expected array');
    return value.flatMap((item, i) => validateTargetValue(definition.items!, item, childPath(path, i)));
  } else if (type === 'Record') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('Expected record');
    const issues: PropertyIssue[] = [];
    for (const key of Object.keys(value))
      if (!own(definition.fields!, key)) issues.push({ path: childPath(path, key), message: 'Unknown field' });
    for (const [key, field] of Object.entries(definition.fields!)) {
      if (!own(value, key)) {
        if (field.required) issues.push({ path: childPath(path, key), message: 'Required field missing' });
      } else issues.push(...validateTargetValue(field, value[key], childPath(path, key)));
    }
    return issues;
  } else if (type === 'DiscriminatedUnion') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected union record');
    const member = matchingDiscriminatedUnionMember(definition as unknown as Record<string, unknown>, value, 'target');
    return member
      ? validateTargetValue(member as unknown as TargetDefinition, value, path)
      : fail('Union value requires an exact matching discriminator tag');
  } else if (type === 'Literal') {
    if (!jsonEqual(value, definition.value)) return fail('Default must equal intrinsic literal');
    return validateTargetValue(definition.valueType!, value, path);
  }
  if (definition.values && !definition.values.some((allowed) => jsonEqual(allowed, value)))
    return fail('Value outside declared domain');
  return [];
}

export function validateTargetDefinition(input: unknown): DefinitionValidation {
  const jsonIssue = jsonValueIssue(input);
  if (jsonIssue) return { valid: false, issues: [jsonIssue] };
  const issues: PropertyIssue[] = [];
  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > 64) {
      issues.push({ path, message: 'Definition depth exceeds 64' });
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push({ path, message: 'Expected target definition' });
      return;
    }
    const d = value as TargetDefinition;
    const add = (key: string, message: string) => issues.push({ path: childPath(path, key), message });
    if (!TARGET_PROPERTY_TYPES.includes(d.type)) {
      add('type', 'Unknown target type');
      return;
    }
    const allowed = new Set(['type', 'id', 'name', 'description', 'required', 'values', 'defaultValue']);
    if (d.type === 'Array') allowed.add('items');
    if (d.type === 'Record') allowed.add('fields');
    if (d.type === 'DiscriminatedUnion') {
      allowed.add('discriminator');
      allowed.add('members');
    }
    if (d.type === 'ResourceLink') allowed.add('allowedResources');
    if (d.type === 'Literal') {
      allowed.add('value');
      allowed.add('valueType');
    }
    for (const key of Object.keys(d)) if (!allowed.has(key)) add(key, 'Unexpected target metadata');
    for (const key of ['id', 'name', 'description'] as const)
      if (own(d, key) && typeof d[key] !== 'string') add(key, 'Expected string');
    if (own(d, 'required') && typeof d.required !== 'boolean') add('required', 'Expected boolean');
    const before = issues.length;
    if (d.type === 'DiscriminatedUnion') {
      issues.push(...discriminatedUnionIssues(d as unknown as Record<string, unknown>, 'target', path));
      if (Array.isArray(d.members))
        d.members.forEach((member, index) => walk(member, childPath(childPath(path, 'members'), index), depth + 1));
    }
    if (d.type === 'Array') walk(d.items, childPath(path, 'items'), depth + 1);
    if (d.type === 'Record') {
      if (!d.fields || typeof d.fields !== 'object' || Array.isArray(d.fields) || Object.keys(d.fields).length === 0)
        add('fields', 'Expected nonempty field dictionary');
      else
        for (const [key, field] of Object.entries(d.fields))
          walk(field, childPath(childPath(path, 'fields'), key), depth + 1);
    }
    if (d.type === 'ResourceLink') {
      if (!Array.isArray(d.allowedResources) || d.allowedResources.length === 0)
        add('allowedResources', 'Expected same-space Entry/Asset resources');
      else
        d.allowedResources.forEach((r, i) => {
          if (
            !r ||
            !['Contentful:Entry', 'Contentful:Asset'].includes(r.type) ||
            r.source !== SAME_SPACE_RESOURCE_SOURCE ||
            Object.keys(r).some(
              (key) => !['type', 'source', ...(r.type === 'Contentful:Entry' ? ['allowedTypes'] : [])].includes(key),
            ) ||
            (r.type === 'Contentful:Entry' &&
              (!Array.isArray(r.allowedTypes) || !r.allowedTypes.every((type) => typeof type === 'string')))
          )
            add(`allowedResources/${i}`, 'Expected same-space Entry/Asset resource');
        });
    }
    if (d.type === 'Literal') {
      if (!own(d, 'value')) add('value', 'Intrinsic literal missing');
      walk(d.valueType, childPath(path, 'valueType'), depth + 1);
    }
    if (own(d, 'values') && (!Array.isArray(d.values) || d.values.length === 0))
      add('values', 'Expected nonempty declared domain');
    if (issues.length !== before) return;
    if (d.values) {
      const withoutDomain = { ...d };
      delete withoutDomain.values;
      d.values.forEach((v, i) =>
        issues.push(...validateTargetValue(withoutDomain, v, childPath(childPath(path, 'values'), i))),
      );
    }
    if (d.type === 'Literal' && own(d, 'value'))
      issues.push(...validateTargetValue(d.valueType!, d.value!, childPath(path, 'value')));
    if (own(d, 'defaultValue')) {
      if (d.type === 'RichText' || d.type === 'JSON') add('defaultValue', 'Target does not support defaults');
      else issues.push(...validateTargetValue(d, d.defaultValue!, childPath(path, 'defaultValue')));
    }
  };
  walk(input, '', 0);
  return { valid: issues.length === 0, issues };
}

/** Portable structure only; runtime validation checks default/domain semantics. */
export const targetDefinitionJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $ref: '#/definitions/target',
  definitions: {
    target: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { enum: [...TARGET_PROPERTY_TYPES] },
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        required: { type: 'boolean' },
        values: { type: 'array', minItems: 1 },
        defaultValue: {},
        items: { $ref: '#/definitions/target' },
        fields: { type: 'object', minProperties: 1, additionalProperties: { $ref: '#/definitions/target' } },
        allowedResources: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['type', 'source'],
            properties: {
              type: { enum: ['Contentful:Entry', 'Contentful:Asset'] },
              source: { const: SAME_SPACE_RESOURCE_SOURCE },
              allowedTypes: { type: 'array', items: { type: 'string' } },
            },
            allOf: [
              {
                if: { properties: { type: { const: 'Contentful:Entry' } } },
                then: { required: ['allowedTypes'] },
                else: { not: { required: ['allowedTypes'] } },
              },
            ],
            additionalProperties: false,
          },
        },
        value: {},
        valueType: { $ref: '#/definitions/target' },
        discriminator: { type: 'string', minLength: 1 },
        members: {
          type: 'array',
          minItems: 2,
          uniqueItems: true,
          items: {
            allOf: [
              { $ref: '#/definitions/target' },
              { type: 'object', properties: { type: { const: 'Record' } }, required: ['type', 'fields'] },
            ],
          },
        },
      },
      allOf: [
        {
          if: { properties: { type: { const: 'DiscriminatedUnion' } } },
          then: { required: ['discriminator', 'members'] },
          else: { not: { anyOf: [{ required: ['discriminator'] }, { required: ['members'] }] } },
        },
      ],
      additionalProperties: false,
    },
  },
} as const;
