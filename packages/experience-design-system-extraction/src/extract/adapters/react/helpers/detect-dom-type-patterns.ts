import { Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import {
  getDomAttributeSurface,
  DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN,
} from './dom-attribute-surfaces.js';
import { collectExpandableDomAttributeWrapperContexts } from './collect-dom-wrapper-contexts.js';

export { isPureExpandableDomAttributeWrapperType } from './detect-dom-is-pure-wrapper.js';
export { containsImportedOmitWrappedCustomProps } from './detect-omit-wrapped-custom-props.js';
export {
  containsSupportedDomPickType,
  containsAnyPickType,
  shouldMergeDomSyntaxExtraction,
} from './detect-pick-type-patterns.js';
export { collectExpandableDomAttributeWrapperContexts, getStringLiteralTypeValues } from './collect-dom-wrapper-contexts.js';

export function getSyntheticDomAttributeProps(typeNode: Node | undefined): RawPropDefinition[] {
  if (!typeNode) return [];
  const contexts = collectExpandableDomAttributeWrapperContexts(typeNode);
  if (contexts.length === 0) return [];

  const propsByName = new Map<string, RawPropDefinition>();
  for (const context of contexts) {
    for (const prop of getDomAttributeSurface(context.name)) {
      if (context.excludedProps.has(prop.name)) continue;
      if (propsByName.has(prop.name)) continue;
      propsByName.set(prop.name, prop);
    }
  }

  return [...propsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function hasSyntheticDomChildren(typeNode: Node | undefined): boolean {
  if (!typeNode) return false;
  return collectExpandableDomAttributeWrapperContexts(typeNode).some((context) =>
    DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN.has(context.name),
  );
}
