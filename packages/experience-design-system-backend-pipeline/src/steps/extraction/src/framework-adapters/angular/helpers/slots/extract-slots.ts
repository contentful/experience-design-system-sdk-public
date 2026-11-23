import type { ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition, RawSlotDefinition } from '../../../../types/component.js';
import type { AngularComponentMetadata } from '../../types/angular-metadata.js';
import { parseNgContentElements } from '../template/parse-ng-content-elements.js';
import { resolveTemplateSource } from '../template/resolve-template-source.js';
import { deriveSlotName } from './derive-slot-name.js';
import { extractContentChildQueries } from './extract-content-child-queries.js';

export async function extractSlots(
  cls: ClassDeclaration,
  meta: AngularComponentMetadata,
  props: RawPropDefinition[],
  warnings?: string[],
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

  for (const query of extractContentChildQueries(cls)) {
    warnings?.push(
      `${query.sourcePath}:${query.startLine}: content query ${query.name} observed: ${query.declaration}; output ownership unresolved.`,
    );
  }

  return { props, slots: [...byName.values()] };
}
