import type { RawPropDefinition, RawComponentDefinition } from '../types.js';

export interface PreClassification {
  category: 'content' | 'design' | 'state' | 'exclude';
  cdfTypeHint?: 'string' | 'enum' | 'richtext' | 'media' | 'boolean';
}

/**
 * Determines whether a type string represents a simple/primitive type
 * (string, boolean, number, or string literal union) vs a complex type
 * (object, function, array, generic, etc.).
 */
function isSimpleType(type: string): boolean {
  const t = type.trim();
  if (t === 'string' || t === 'boolean' || t === 'number') return true;
  // String literal union (e.g., "'a' | 'b'")
  if (isStringLiteralUnion(t)) return true;
  return false;
}

function isStringLiteralUnion(type: string): boolean {
  return type.includes('|') && type.includes("'");
}

function isBooleanType(type: string): boolean {
  return type.trim() === 'boolean';
}

function isStringType(type: string): boolean {
  return type.trim() === 'string';
}

function isNumberType(type: string): boolean {
  return type.trim() === 'number';
}

function isComplexType(type: string): boolean {
  return !isSimpleType(type);
}

const DOM_PASS_THROUGH_PROPS = new Set([
  // Bare HTML / framework styling pass-through
  'className',
  'class',
  'classes',
  'classNames',
  'rootClassName',
  'prefixCls',
  'style',
  'styles',
  // Bare HTML attributes
  'id',
  'role',
  'tabIndex',
  'tabindex',
  'name',
  'htmlFor',
  'for',
  'slot',
  'is',
  'lang',
  'dir',
  'hidden',
  'draggable',
  'spellCheck',
  'spellcheck',
  'contentEditable',
  'contenteditable',
  'inputMode',
  'inputmode',
  'autoComplete',
  'autocomplete',
  'autoFocus',
  'autofocus',
  'translate',
  'part',
  'exportparts',
  'aria',
  // Framework theming / pass-through escape hatches — dev-facing, never marketer-configurable
  'dt',
  'pt',
  'ptOptions',
  'unstyled',
  // Polymorphic component props — change rendered HTML/component, not marketer-visible behavior
  'as',
  'element',
  'component',
  // QA / vendor test attributes
  'dataQa',
  'data-qa',
  // Vue v-model internals — framework wiring, never marketer-configurable
  'modelValue',
  'modelModifiers',
]);

function isDomPassThroughProp(name: string): boolean {
  if (DOM_PASS_THROUGH_PROPS.has(name)) return true;
  // aria-label, aria-hidden, ariaLabel, ariaHidden — both kebab and camel forms
  if (/^aria[-A-Z]/.test(name)) return true;
  if (name.startsWith('data-')) return true;
  return false;
}

/**
 * Deterministic pre-classification rule engine.
 * Applies rules in priority order and returns on the first match.
 */
export function preClassifyProp(prop: RawPropDefinition): PreClassification | undefined {
  const { name, type } = prop;

  // Rule 1: Event handlers
  // name starts with `on` + uppercase, OR type contains `=> void` or `EventHandler`
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
  // These are escape hatches developers use to wire components into the DOM.
  // Marketers should never configure them in the ExO editor; exposing them
  // generates noise that obscures the props that actually carry intent.
  if (isDomPassThroughProp(name)) {
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
 * - Does NOT set category for 'exclude' results (leaves undefined)
 */
export function preClassifyComponent(component: RawComponentDefinition): RawComponentDefinition {
  const props = component.props.map((prop) => {
    // If category is already set, leave unchanged
    if (prop.category) {
      return prop;
    }

    const result = preClassifyProp(prop);

    // If no result or excluded, leave unchanged
    if (!result || result.category === 'exclude') {
      return prop;
    }

    // Set category hint
    return { ...prop, category: result.category as 'content' | 'design' | 'state' };
  });

  return { ...component, props };
}
