import type { RawPropDefinition, RawSlotDefinition } from '../../../model/component.js';
import type { ResolvedTypeMember } from './resolve-svelte-type-members.js';
import type { PropsExtractionResult } from './extract-svelte-props.js'; // type-only: no runtime cycle

type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
};

export function extractFromTypeMembersOnly(typeMembers: ResolvedTypeMember[]): PropsExtractionResult {
  const props: RawPropDefinition[] = [];
  const snippetNames = new Set<string>();
  const snippetSlots: RawSlotDefinition[] = [];

  for (const m of typeMembers) {
    if (m.isSnippet) {
      snippetNames.add(m.name);
      const slot: RawSlotDefinitionInternal = {
        name: m.name,
        isDefault: m.name === 'children',
        ...(m.description ? { description: m.description } : {}),
      };
      const authorText = m.declaredTypeText ?? m.typeText;
      if (authorText) slot._rawTypeText = authorText;
      snippetSlots.push(slot);
      continue;
    }
    const propDef: RawPropDefinition = {
      name: m.name,
      type: m.typeText,
      required: !m.optional,
    };
    if (m.allowedValues) propDef.allowedValues = m.allowedValues;
    if (m.description) propDef.description = m.description;
    props.push(propDef);
  }

  return { props, snippetNames, snippetSlots, warnings: [] };
}
