import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../../types/component.js';

export interface AuthoringSurfaceCheck {
  skip: boolean;
  reason?: string;
}

const HANDLER_TYPE_PATTERN = /=>|EventHandler|Dispatch<|SetStateAction/;
const REF_TYPE_PATTERN = /Ref<|RefObject<|MutableRefObject/;

/** Returns true when the prop is an event-handler function or a React ref — not something a content editor configures. */
export function isHandlerOrRefProp(prop: RawPropDefinition): boolean {
  if (HANDLER_TYPE_PATTERN.test(prop.type)) return true;
  if (REF_TYPE_PATTERN.test(prop.type)) return true;
  if (/^on[A-Z]/.test(prop.name) || /^set[A-Z]/.test(prop.name)) return true;
  if (prop.name === 'ref' || prop.name === 'innerRef') return true;
  return false;
}

/** Rule 1: no props AND no slots — analytics scripts, GTM tags, layout fixers, security tokens, etc. */
export function hasNoPropsAndNoSlots(props: RawPropDefinition[], slots: RawSlotDefinition[]): boolean {
  return props.length === 0 && slots.length === 0;
}

/** Rule 2: createContext source with a prop literally named `value` — the canonical `<Context.Provider value={...}>` call site. */
export function isContextProviderWithValueProp(
  props: RawPropDefinition[],
  usesCreateContext: boolean | undefined,
): boolean {
  return !!usesCreateContext && props.some((p) => p.name === 'value');
}

/** Rule 3: createContext source with zero props — a Provider that hard-codes its context value internally (e.g. FontProvider). */
export function isHardwiredContextProvider(
  props: RawPropDefinition[],
  usesCreateContext: boolean | undefined,
): boolean {
  return !!usesCreateContext && props.length === 0;
}

/** Rule 4: createContext source with exactly one non-handler prop — a Provider that takes its context value as a single data prop (e.g. LocaleProvider, NavigationProvider). */
export function isSingleDataPropContextWrapper(
  props: RawPropDefinition[],
  usesCreateContext: boolean | undefined,
): boolean {
  return !!usesCreateContext && props.length === 1 && !isHandlerOrRefProp(props[0]!);
}

/** Rule 5: every prop is an event handler or ref — pure plumbing with no authoring surface (e.g. OsanoCookiePlaceholder({ onBannerLoaded })). */
export function hasOnlyEventHandlers(props: RawPropDefinition[]): boolean {
  return props.length > 0 && props.every(isHandlerOrRefProp);
}

/**
 * Checks whether a component has no surface for a content editor to configure.
 * Returns { skip: true, reason } for infrastructure components that should be
 * flagged for operator review before authoring-token generation.
 *
 * Uses prop-shape signals only — no component-name or source-path patterns.
 * A design system can live anywhere under any naming convention; relying on
 * suffixes like `*Provider` or paths like `src/lib/` would silently fail in
 * other repos.
 */
export function hasNoAuthoringSurface(component: RawComponentDefinition): AuthoringSurfaceCheck {
  const { props, slots, usesCreateContext } = component;

  if (hasNoPropsAndNoSlots(props, slots))
    return { skip: true, reason: 'component has no props and no slots' };

  if (isContextProviderWithValueProp(props, usesCreateContext))
    return { skip: true, reason: 'source uses createContext and component exposes a Context.Provider value prop' };

  if (isHardwiredContextProvider(props, usesCreateContext))
    return { skip: true, reason: 'source uses createContext and component has no props' };

  if (isSingleDataPropContextWrapper(props, usesCreateContext))
    return { skip: true, reason: 'source uses createContext and component has a single non-handler prop' };

  if (hasOnlyEventHandlers(props))
    return { skip: true, reason: 'every prop is a handler or ref' };

  return { skip: false };
}
