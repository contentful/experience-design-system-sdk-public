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
  'sx',
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

/** Returns true when the prop name is a DOM attribute, a11y attribute, or framework pass-through escape hatch. */
export function isDomPassThroughProp(name: string): boolean {
  if (DOM_PASS_THROUGH_PROPS.has(name)) return true;
  // aria-label, aria-hidden, ariaLabel, ariaHidden — both kebab and camel forms
  if (/^aria[-A-Z]/.test(name)) return true;
  return name.startsWith('data-');
}
