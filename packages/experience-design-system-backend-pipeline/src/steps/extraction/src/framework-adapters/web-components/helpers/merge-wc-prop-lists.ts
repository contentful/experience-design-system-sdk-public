import type { RawPropDefinition } from '../../../types/component.js';

export { extractClassProperties } from './extract-wc-class-properties.js';

export function mergePropLists(...propLists: RawPropDefinition[][]): RawPropDefinition[] {
  const merged = new Map<string, RawPropDefinition>();
  for (const propList of propLists) {
    for (const prop of propList) {
      merged.set(prop.name, prop);
    }
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
