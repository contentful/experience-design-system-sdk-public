import type { RawComponentDefinition, RawSlotDefinition } from '../../../types/component.js';
import { extractAllowedComponentsFromTypeText, extractAllowedComponentsFromJsdoc } from '../../../helpers/evidence/collect-allowed-component-names.js';

type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
  _rawJsdoc?: string;
};

export function resolveReactAllowedComponents(components: RawComponentDefinition[]): void {
  const propsToComponent = new Map<string, string>();
  const componentNames = new Set<string>();
  for (const c of components as Array<RawComponentDefinition & { _propsTypeName?: string }>) {
    componentNames.add(c.name);
    if (c._propsTypeName) propsToComponent.set(c._propsTypeName, c.name);
  }

  for (const c of components as Array<RawComponentDefinition & { _propsTypeName?: string }>) {
    for (const slot of c.slots as RawSlotDefinitionInternal[]) {
      const found = new Set<string>();
      if (slot._rawTypeText) {
        for (const n of extractAllowedComponentsFromTypeText(slot._rawTypeText, { propsToComponent, componentNames })) {
          found.add(n);
        }
      }
      if (slot._rawJsdoc) {
        for (const n of extractAllowedComponentsFromJsdoc(slot._rawJsdoc, componentNames)) {
          found.add(n);
        }
      }
      delete slot._rawTypeText;
      delete slot._rawJsdoc;
      if (found.size > 0) slot.allowedComponents = [...found].sort();
    }
    delete c._propsTypeName;
  }
}
