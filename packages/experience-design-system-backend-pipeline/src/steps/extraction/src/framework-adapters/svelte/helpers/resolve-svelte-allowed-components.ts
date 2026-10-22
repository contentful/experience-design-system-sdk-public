import type { RawComponentDefinition, RawSlotDefinition } from '../../../types/component.js';
import { extractAllowedComponentsFromTypeText } from '../../../helpers/evidence/collect-allowed-component-names.js';
import { buildComponentLookupMaps } from '../../shared/helpers/build-component-lookup-maps.js';

type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
};
type ComponentWithInternalProps = RawComponentDefinition & {
  _propsTypeName?: string;
};

export function resolveAllowedComponents(components: RawComponentDefinition[]): void {
  const { propsToComponent, componentNames } = buildComponentLookupMaps(components);

  for (const c of components as ComponentWithInternalProps[]) {
    for (const slot of c.slots as RawSlotDefinitionInternal[]) {
      const raw = slot._rawTypeText;
      if (raw) {
        const found = extractAllowedComponentsFromTypeText(raw, {
          propsToComponent,
          componentNames,
        });
        if (found.length > 0) slot.allowedComponents = found;
      }
      delete slot._rawTypeText;
    }
    delete c._propsTypeName;
  }
}
