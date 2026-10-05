import type { RawComponentDefinition } from '../../../types/component.js';

type ComponentWithInternalProps = RawComponentDefinition & { _propsTypeName?: string };

export function buildComponentLookupMaps(components: RawComponentDefinition[]): {
  propsToComponent: Map<string, string>;
  componentNames: Set<string>;
} {
  const propsToComponent = new Map<string, string>();
  const componentNames = new Set<string>();
  for (const c of components as ComponentWithInternalProps[]) {
    componentNames.add(c.name);
    if (c._propsTypeName) propsToComponent.set(c._propsTypeName, c.name);
  }
  return { propsToComponent, componentNames };
}
