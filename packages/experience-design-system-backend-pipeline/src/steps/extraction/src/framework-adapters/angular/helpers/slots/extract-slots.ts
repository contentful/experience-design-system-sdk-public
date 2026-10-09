import type { ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition, RawSlotDefinition } from '../../../../types/component.js';
import type { AngularComponentMetadata } from '../types/angular-metadata.js';
import { parseNgContentElements } from '../template/parse-ng-content-elements.js';
import { resolveTemplateSource } from '../template/resolve-template-source.js';
import { deriveSlotName } from './derive-slot-name.js';
import { extractContentChildQueries } from './extract-content-child-queries.js';
import { extractTemplateRefSlots } from './extract-template-ref-slots.js';

/**
 * Collect slots from all three implemented families, in order:
 *   1. `<ng-content>` tags in the template (inline or `templateUrl` file)
 *   2. `contentChild()` / `contentChildren()` / `@ContentChild(X)` queries
 *   3. TemplateRef-typed props → re-emitted as slots
 *
 * Also mutates the props list by removing pure-TemplateRef props (family 3).
 * Dedup rule: a slot name produced earlier wins; later families don't override.
 *
 * The fourth family (DI-based composition in Spartan / radix-ng) is punted —
 * we emit each sub-component as its own loose component, and a future
 * composition pass can wire them up.
 */
export async function extractSlots(
  cls: ClassDeclaration,
  meta: AngularComponentMetadata,
  props: RawPropDefinition[],
): Promise<{ props: RawPropDefinition[]; slots: RawSlotDefinition[] }> {
  const byName = new Map<string, RawSlotDefinition>();

  // 1. <ng-content> tags
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

  // 2. contentChild / contentChildren / @ContentChild queries
  for (const slot of extractContentChildQueries(cls)) {
    if (!byName.has(slot.name)) byName.set(slot.name, slot);
  }

  // 3. TemplateRef-typed props → slots (also filters the props list)
  const split = extractTemplateRefSlots(props);
  for (const slot of split.slots) {
    if (!byName.has(slot.name)) byName.set(slot.name, slot);
  }

  return { props: split.props, slots: [...byName.values()] };
}
