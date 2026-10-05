import type { RawComponentDefinition, RawSlotDefinition } from '../../../types/component.js';
import { extractAllowedComponentsFromTypeText } from '../../../helpers/evidence/collect-allowed-component-names.js';

type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
};

export function resolveAllowedComponents(components: RawComponentDefinition[]): void {
  const propsToComponent = new Map<string, string>();
  const componentNames = new Set<string>();
  for (const c of components as Array<RawComponentDefinition & { _propsTypeName?: string }>) {
    componentNames.add(c.name);
    if (c._propsTypeName) propsToComponent.set(c._propsTypeName, c.name);
  }

  for (const c of components as Array<RawComponentDefinition & { _propsTypeName?: string }>) {
    for (const slot of c.slots as RawSlotDefinitionInternal[]) {
      const raw = slot._rawTypeText;
      if (raw) {
        const found = extractAllowedComponentsFromTypeText(raw, { propsToComponent, componentNames });
        if (found.length > 0) slot.allowedComponents = found;
      }
      delete slot._rawTypeText;
    }
    delete c._propsTypeName;
  }
}
