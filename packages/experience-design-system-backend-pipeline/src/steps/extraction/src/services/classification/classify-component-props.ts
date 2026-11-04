import type { RawPropDefinition, RawComponentDefinition } from '../../types/component.js';
import type { PreClassification } from '../../types/classification.js';

export type { PreClassification } from '../../types/classification.js';

/** Preserve supplied decisions; names and source type text do not prove a semantic category. */
export function preClassifyProp(prop: RawPropDefinition): PreClassification | undefined {
  return prop.category ? { category: prop.category } : undefined;
}

/** Retain every source input for evidence-backed classification and explicit review. */
export function preClassifyComponent(component: RawComponentDefinition): RawComponentDefinition {
  return { ...component, props: [...component.props] };
}
