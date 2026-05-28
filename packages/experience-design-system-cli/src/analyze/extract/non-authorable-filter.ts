import type { RawComponentDefinition } from '../../types.js';

export interface NonAuthorableResult {
  skip: boolean;
  reason?: string;
}

const PROVIDER_NAME_PATTERN = /(Provider|Context)$/;

/**
 * Decides whether a component is non-authorable infrastructure (e.g. a React
 * Context.Provider wrapper, a runtime-only analytics shim) and should be
 * filtered out of the analyze TUI.
 *
 * Rules (any match → skip):
 *  A. Name ends in `Provider`/`Context` AND source file calls createContext.
 *  B. Source file calls createContext AND props include a `value` prop typed
 *     as `<T> | null`/`<T>` (the canonical Context.Provider signature).
 *  C. Component has at least one prop, and zero props were classified as
 *     content/design/state by pre-classify.
 *
 * Components with no props at all are kept (they may be layout wrappers like
 * `<Stack>` that legitimately accept only children).
 */
export function isNonAuthorableComponent(component: RawComponentDefinition): NonAuthorableResult {
  // Rule A: name + createContext signal
  if (component.usesCreateContext && PROVIDER_NAME_PATTERN.test(component.name)) {
    return {
      skip: true,
      reason: `name matches Provider/Context pattern and source uses createContext`,
    };
  }

  // Rule B: createContext + canonical Context.Provider prop shape
  if (component.usesCreateContext) {
    const hasValueProp = component.props.some((p) => p.name === 'value');
    if (hasValueProp) {
      return {
        skip: true,
        reason: `source uses createContext and component exposes a Context.Provider value prop`,
      };
    }
  }

  // Rule C: pre-classify yielded zero authorable props on a component that has props
  if (component.props.length > 0) {
    const authorable = component.props.filter(
      (p) => p.category === 'content' || p.category === 'design' || p.category === 'state',
    );
    if (authorable.length === 0) {
      return {
        skip: true,
        reason: `no authorable props after pre-classification`,
      };
    }
  }

  return { skip: false };
}
