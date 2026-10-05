import type { RawPropDefinition } from '../../model/component.js';
import type { ClassDeclaration } from 'ts-morph';

export { extractObservedAttributes } from './helpers/extract-wc-observed-attrs.js';
export { extractAccessorProperties } from './helpers/extract-wc-accessor-props.js';
export { extractJsDocAttributeProps } from './helpers/extract-wc-jsdoc-attr-props.js';
export { extractClassProperties } from './helpers/extract-wc-class-properties.js';

export function hasShoelaceRuntimeBookkeepingField(classDecl: ClassDeclaration): boolean {
  return classDecl.getProperties().some((property) => property.getName() === 'initialReflectedProperties');
}

export function mergePropLists(...propLists: RawPropDefinition[][]): RawPropDefinition[] {
  const merged = new Map<string, RawPropDefinition>();
  for (const propList of propLists) {
    for (const prop of propList) {
      merged.set(prop.name, prop);
    }
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeProps(observed: RawPropDefinition[], classProps: RawPropDefinition[]): RawPropDefinition[] {
  return mergePropLists(observed, classProps);
}
