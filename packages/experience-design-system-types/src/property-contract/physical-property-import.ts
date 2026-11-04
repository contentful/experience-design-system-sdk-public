import type { CDFFieldDefinition } from '../cdf/types.js';
import { cdfToTarget, cdfDefinitionChildren } from '../cdf/property-validation.js';
import { DESIGN_TOKEN_TYPES } from '../dtcg/token-types.js';
import { childPath, own, type PropertyIssue } from './json-value.js';

/** Finite choices stay in the source; target mapping owns enforcement and loss reporting. */
export function propertyDefinitionImportBlockers(definition: CDFFieldDefinition, path = ''): string[] {
  return propertyDefinitionImportIssues(definition).map((issue) => `${path}${issue.path}: ${issue.message}`);
}

/** Physical restrictions apply to emitted fields, never to retained source evidence. */
export function propertyDefinitionImportIssues(definition: CDFFieldDefinition): PropertyIssue[] {
  if (definition.$category === 'state' || definition.$category === 'unattached') return [];
  const issues: PropertyIssue[] = [];
  if (definition.$category === 'design') {
    if (!['String', 'Number', 'Boolean'].includes(cdfToTarget(definition).type))
      issues.push({ path: '', message: 'Structured design properties require a model representation' });
    if (definition.$type === 'token') {
      if (!(DESIGN_TOKEN_TYPES as readonly unknown[]).includes(definition['$token.kind']))
        issues.push({ path: '/$token.kind', message: 'Token properties require a recognized token kind' });
      for (const [index, reference] of (definition['$token.allowed'] ?? []).entries())
        if (!reference.trim())
          issues.push({ path: '/$token.allowed/' + index, message: 'Token reference must not be empty' });
      if (own(definition, '$default') && !String(definition.$default).trim())
        issues.push({ path: '/$default', message: 'Token reference must not be empty' });
    }
    return issues;
  }
  const unsafeValueKeys = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const childLocation = childPath(path, key);
      if (key === '__proto__')
        issues.push({
          path: childLocation,
          message:
            'The storage update path cannot preserve this object key; select a source-derived model representation',
        });
      else unsafeValueKeys(child, childLocation);
    }
  };
  const walk = (field: CDFFieldDefinition, path: string): void => {
    if (field.$type === 'array' && path !== '')
      issues.push({ path, message: 'Nested Array fields require a source-derived model representation' });
    if (field.$type === 'record' && path !== '' && path !== '/$items')
      issues.push({ path, message: 'Nested Record fields require a source-derived model representation' });
    if (own(field, '$default')) unsafeValueKeys(field.$default, path + '/$default');
    if (own(field, 'value')) unsafeValueKeys(field.value, path + '/value');
    for (const child of cdfDefinitionChildren(field)) walk(child.definition, path + child.path);
  };
  walk(definition, '');
  return issues;
}
