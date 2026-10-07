import type { RawPropDefinition, RawComponentDefinition } from '../../types/component.js';
import type { PreClassification } from '../../types/classification.js';
import {
  isStringLiteralUnion,
  isBooleanType,
  isStringType,
  isNumberType,
  isComplexType,
} from './helpers/check-prop-types.js';
import { isDomPassThroughProp } from './helpers/detect-dom-props.js';

export type { PreClassification } from '../../types/classification.js';

/**
 * Deterministic pre-classification rule engine.
 * Applies rules in priority order and returns on the first match.
 */
export function preClassifyProp(prop: RawPropDefinition): PreClassification | undefined {
  const { name, type } = prop;

  // Rule 1: Event handlers
  if (/^on[A-Z]/.test(name) || type.includes('=> void') || type.includes('EventHandler')) {
    return { category: 'exclude' };
  }

  // Rule 2: Refs
  if (name === 'ref' || name === 'innerRef' || type.includes('Ref<') || type.includes('RefObject<')) {
    return { category: 'exclude' };
  }

  // Rule 3: Test IDs
  if (name === 'testId' || name === 'data-testid' || name === 'dataTestId') {
    return { category: 'exclude' };
  }

  // Rule 4: Key prop
  if (name === 'key') {
    return { category: 'exclude' };
  }

  // Rule 5: Dispatch/setter
  if (type.includes('Dispatch<') || type.includes('SetStateAction')) {
    return { category: 'exclude' };
  }

  // Rule 6: DOM / a11y / framework pass-through props
  if (isDomPassThroughProp(name)) {
    return { category: 'exclude' };
  }

  // `name` is overloaded: form controls forward it to the DOM, while icons,
  // flags, and animations often use it as an authorable semantic selector.
  // Exclude only when the extractor retained concrete DOM provenance.
  if (name === 'name' && prop.domAttribute) {
    return { category: 'exclude' };
  }

  // Rule 7: String literal union
  if (isStringLiteralUnion(type)) {
    return { category: 'design', cdfTypeHint: 'enum' };
  }

  // Rule 8: Design name patterns (only for simple types)
  if (!isComplexType(type)) {
    const designNameStart = /^(variant|size|spacing|gap|color|bg|theme|align|layout|orientation|position)/i;
    const designNameEnd = /(Color|Size|Variant|Style)$/;
    if (designNameStart.test(name) || designNameEnd.test(name)) {
      return { category: 'design', cdfTypeHint: 'string' };
    }
  }

  // Rule 10: Boolean + state names (checked before rule 9 since state names
  // like "disabled" would otherwise match the visual toggle prefix "disable")
  if (isBooleanType(type)) {
    const stateNames = ['disabled', 'loading', 'expanded', 'isOpen', 'selected', 'checked', 'active', 'preview'];
    if (stateNames.includes(name)) {
      return { category: 'state', cdfTypeHint: 'boolean' };
    }
  }

  // Rule 9: Boolean + visual toggle name
  if (isBooleanType(type)) {
    const visualToggle = /^(hide|show|enable|disable|vertical|horizontal|reverse|bold|italic|imageOn|with)/i;
    if (visualToggle.test(name)) {
      return { category: 'design', cdfTypeHint: 'boolean' };
    }
  }

  // Rule 11: State identifiers
  if (name === 'componentId' || name === 'sectionKey' || name === 'locale' || name === 'variantIndex') {
    return { category: 'state', cdfTypeHint: 'string' };
  }

  // Rule 12: URL patterns (string type only)
  if (isStringType(type)) {
    const urlNameStart = /^(href|url|link|src)/i;
    const urlNameEnd = /(Url|Href|Link|Src)$/;
    if (urlNameStart.test(name) || urlNameEnd.test(name)) {
      return { category: 'content', cdfTypeHint: 'string' };
    }
  }

  // Rule 13: Text patterns (string type only)
  if (isStringType(type)) {
    const textNameStart =
      /^(label|title|text|description|caption|heading|subheading|body|alt|name|placeholder|summary)/i;
    const textNameEnd = /(Text|Label|Title|Name)$/;
    if (textNameStart.test(name) || textNameEnd.test(name)) {
      return { category: 'content', cdfTypeHint: 'string' };
    }
  }

  // Rule 14: Remaining strings
  if (isStringType(type)) {
    return { category: 'content', cdfTypeHint: 'string' };
  }

  // Rule 15: Remaining booleans
  if (isBooleanType(type)) {
    return { category: 'design', cdfTypeHint: 'boolean' };
  }

  // Rule 16: Remaining numbers
  if (isNumberType(type)) {
    return { category: 'design', cdfTypeHint: 'string' };
  }

  // Rule 17: Complex/object/function/array types — no hint
  return undefined;
}

/**
 * Applies pre-classification to all props in a component definition.
 * - Leaves existing category values unchanged
 * - Sets category for content/design/state matches
 * - Removes props that match an exclusion rule so they cannot reach agent classification
 */
export function preClassifyComponent(component: RawComponentDefinition): RawComponentDefinition {
  const props = component.props.flatMap((prop) => {
    const result = preClassifyProp(prop);

    // Excluded props are developer-facing wiring and must not be included in
    // the component payload passed to classification or generation, even if a
    // prior step assigned them a category.
    if (result?.category === 'exclude') {
      return [];
    }

    // Provenance is extraction-only evidence. Do not add it to the payload
    // presented to downstream agents.
    const { domAttribute: _domAttribute, ...authorableProp } = prop;

    if (prop.category) {
      return [authorableProp];
    }

    if (!result) {
      return [authorableProp];
    }

    return [
      {
        ...authorableProp,
        category: result.category as 'content' | 'design' | 'state',
      },
    ];
  });

  return { ...component, props };
}
