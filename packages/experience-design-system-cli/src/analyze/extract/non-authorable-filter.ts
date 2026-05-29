import type { RawComponentDefinition, RawPropDefinition } from '../../types.js';

export interface NonAuthorableResult {
  skip: boolean;
  reason?: string;
}

const HANDLER_TYPE_PATTERN = /=>|EventHandler|Dispatch<|SetStateAction/;
const REF_TYPE_PATTERN = /Ref<|RefObject<|MutableRefObject/;

function isHandlerOrRefProp(prop: RawPropDefinition): boolean {
  if (HANDLER_TYPE_PATTERN.test(prop.type)) return true;
  if (REF_TYPE_PATTERN.test(prop.type)) return true;
  if (/^on[A-Z]/.test(prop.name) || /^set[A-Z]/.test(prop.name)) return true;
  if (prop.name === 'ref' || prop.name === 'innerRef') return true;
  return false;
}

/**
 * Decides whether a component is non-authorable infrastructure (Context.Provider,
 * analytics shim, layout-only utility, etc.) and should be filtered out of the
 * analyze TUI before authoring-token generation.
 *
 * Uses prop-shape signals only — no component-name or source-path patterns.
 * A design system can live anywhere under any naming convention; relying on
 * suffixes like `*Provider` or paths like `src/lib/` would silently fail in
 * other repos. See `docs/superpowers/plans/2026-05-28-rule-c-monte-carlo-eval.md`
 * for the data and reasoning.
 */
export function isNonAuthorableComponent(component: RawComponentDefinition): NonAuthorableResult {
  const { props, slots, usesCreateContext } = component;

  // R1: zero props AND zero slots — nothing for an editor to author.
  // Catches analytics scripts, GTM tags, layout fixers, security tokens, etc.
  if (props.length === 0 && slots.length === 0) {
    return { skip: true, reason: 'component has no props and no slots' };
  }

  // R2: createContext source + prop literally named `value` — canonical
  // `<Context.Provider value={...}>` call site.
  if (usesCreateContext && props.some((p) => p.name === 'value')) {
    return {
      skip: true,
      reason: 'source uses createContext and component exposes a Context.Provider value prop',
    };
  }

  // R3: createContext source + zero props — Provider wrapper that hard-codes
  // the context value internally (e.g. FontProvider, BottomSheetProvider).
  if (usesCreateContext && props.length === 0) {
    return { skip: true, reason: 'source uses createContext and component has no props' };
  }

  // R4: createContext source + exactly one non-handler prop — Provider that
  // takes the context value as its sole data prop, named after the data
  // (e.g. `LocaleProvider({ locale })`, `NavigationProvider({ navItems })`).
  if (usesCreateContext && props.length === 1 && !isHandlerOrRefProp(props[0])) {
    return {
      skip: true,
      reason: 'source uses createContext and component has a single non-handler prop',
    };
  }

  // R5: every prop is a handler/ref — pure data plumbing, no authoring surface.
  // Catches components like `OsanoCookiePlaceholder({ onBannerLoaded })` or
  // `FeedbackCard({ setShowModal })`.
  if (props.length > 0 && props.every(isHandlerOrRefProp)) {
    return { skip: true, reason: 'every prop is a handler or ref' };
  }

  return { skip: false };
}
