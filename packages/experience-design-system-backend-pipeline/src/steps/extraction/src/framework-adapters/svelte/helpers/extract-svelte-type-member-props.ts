import type { RawPropDefinition } from '../../../types/component.js';
import type { ResolvedTypeMember } from './resolve-svelte-type-members.js';
import type { PropsExtractionResult } from './extract-svelte-props.js';

export function extractFromTypeMembersOnly(typeMembers: ResolvedTypeMember[]): PropsExtractionResult {
  const props: RawPropDefinition[] = [];
  const snippetNames = new Set<string>();

  for (const m of typeMembers) {
    if (m.isSnippet) {
      snippetNames.add(m.name);
    }
    const propDef: RawPropDefinition = {
      name: m.name,
      type: m.declaredTypeText ?? m.typeText,
      required: !m.optional,
    };
    if (m.allowedValues) propDef.allowedValues = m.allowedValues;
    if (m.description) propDef.description = m.description;
    props.push(propDef);
  }

  return { props, snippetNames, warnings: [] };
}
