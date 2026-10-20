import type { CDFFieldDefinition } from './types.js';
import { CDF_PROPERTY_TYPES, CDF_PROPERTY_CATEGORIES } from './vocabularies.js';
import { childPath, jsonValueIssue, own, type PropertyIssue } from '../property-contract/json-value.js';
import { validateTargetDefinition, type TargetDefinition } from '../property-contract/target-definition.js';

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
} as const;
export function cdfToTarget(d: CDFFieldDefinition): TargetDefinition {
  const t: TargetDefinition = { type: targetTypes[d.$type] };
  if (own(d, '$required')) t.required = d.$required;
  if (own(d, '$description')) t.description = d.$description;
  if (own(d, '$default')) t.defaultValue = d.$default;
  if (d.$values) t.values = d.$values;
  if (d.$items) t.items = cdfToTarget(d.$items);
  if (d.$fields)
    t.fields = Object.fromEntries(Object.entries(d.$fields).map(([key, field]) => [key, cdfToTarget(field)]));
  return t;
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
    if (!CDF_PROPERTY_TYPES.includes(d.$type)) {
      add('$type', 'Unknown CDF type');
      return;
    }
    if ((root && requireCategory) || own(d, '$category'))
      if (!CDF_PROPERTY_CATEGORIES.includes(d.$category!)) add('$category', 'Unknown category');
    const allowed = new Set(['$type', '$category', '$description', '$required', '$default', '$values']);
    if (d.$type === 'array') allowed.add('$items');
    if (d.$type === 'record') allowed.add('$fields');
    if (d.$type === 'token') {
      allowed.add('$token.kind');
      allowed.add('$token.allowed');
    }
    for (const key of Object.keys(d)) if (!allowed.has(key)) add(key, 'Unexpected property metadata');
    if (own(d, '$description') && typeof d.$description !== 'string') add('$description', 'Expected string');
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
