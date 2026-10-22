import type { CDFComponentEntry, CDFFieldDefinition } from '../cdf/types.js';
import { childPath, own } from './json-value.js';

/** This vocabulary describes the deployed transport, independently of desired file support. */
const DEPLOYED_CONTENT_TYPES: readonly string[] = [
  'string',
  'richtext',
  'number',
  'media',
  'link',
  'token',
  'boolean',
  'array',
  'record',
];
const DEPLOYED_DESIGN_TYPES: readonly string[] = ['string', 'boolean', 'token'];

export function propertyMapperBlockers(
  definition: CDFFieldDefinition,
  path = '',
  category = definition.$category,
): string[] {
  if (category !== 'content' && category !== 'design') return [];
  const types = category === 'design' ? DEPLOYED_DESIGN_TYPES : DEPLOYED_CONTENT_TYPES;
  const blockers = types.includes(definition.$type) ? [] : [`${path} (${definition.$type} mapper unavailable)`];
  if (own(definition, '$values')) blockers.push(`${path}/$values (finite-choice mapper unavailable)`);
  if (definition.$items) blockers.push(...propertyMapperBlockers(definition.$items, `${path}/$items`, category));
  if (definition.valueType)
    blockers.push(...propertyMapperBlockers(definition.valueType, `${path}/valueType`, category));
  for (const [index, member] of (definition.members ?? []).entries())
    blockers.push(...propertyMapperBlockers(member, `${path}/members/${index}`, category));
  for (const [key, field] of Object.entries(definition.$fields ?? {}))
    blockers.push(...propertyMapperBlockers(field, childPath(`${path}/$fields`, key), category));
  return blockers;
}

export function mapperApplyBlockers(components: readonly { key: string; entry: CDFComponentEntry }[]): string[] {
  return components.flatMap(({ key, entry }) =>
    Object.entries(entry.$properties).flatMap(([name, definition]) =>
      propertyMapperBlockers(definition, childPath(childPath('', key) + '/$properties', name)),
    ),
  );
}
