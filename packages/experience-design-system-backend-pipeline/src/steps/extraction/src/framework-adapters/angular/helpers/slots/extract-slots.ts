import type { ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition, RawSlotDefinition } from '../../../../types/component.js';
import type { AngularComponentMetadata } from '../../types/angular-metadata.js';
import { parseNgContentElements } from '../template/parse-ng-content-elements.js';
import { resolveTemplateSource } from '../template/resolve-template-source.js';
import { deriveSlotName } from './derive-slot-name.js';
import { extractContentChildQueries } from './extract-content-child-queries.js';
import { extractTemplateRefSlots } from './extract-template-ref-slots.js';

export async function extractSlots(
  cls: ClassDeclaration,
  meta: AngularComponentMetadata,
  props: RawPropDefinition[],
): Promise<{ props: RawPropDefinition[]; slots: RawSlotDefinition[] }> {
  const byName = new Map<string, RawSlotDefinition>();

  const template = await resolveTemplateSource(meta);
  if (template) {
    for (const el of parseNgContentElements(template)) {
      const name = deriveSlotName(el.rawSelect, meta.normalizedName);
      if (byName.has(name)) continue;
      byName.set(name, {
        name,
        isDefault: el.rawSelect === null,
      });
    }
  }

  for (const slot of extractContentChildQueries(cls)) {
    if (!byName.has(slot.name)) byName.set(slot.name, slot);
  }

  const split = extractTemplateRefSlots(props);
  for (const slot of split.slots) {
    if (!byName.has(slot.name)) byName.set(slot.name, slot);
  }

  return { props: split.props, slots: [...byName.values()] };
}
