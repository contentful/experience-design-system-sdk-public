/**
 * Cross-framework context used by both React and Svelte adapters when they
 * resolve which component types a slot or snippet accepts. Maps raw TS type
 * identifiers (e.g. `ButtonProps`) to the component names that own them.
 */
export interface AllowedComponentsContext {
  propsToComponent: ReadonlyMap<string, string>;
  componentNames: ReadonlySet<string>;
}

/**
 * Matches `ReactElement<XProps>` and `ReactElement<XProps, ...>` — TS often
 * expands the second generic argument to `string | JSXElementConstructor<any>`.
 * Only the first generic argument (the props type name) is captured.
 */
export const REACT_ELEMENT_GENERIC = /(?:React\.)?ReactElement\s*<\s*([A-Za-z_$][\w$.]*)(?![\w$.])/g;

/** Matches `Snippet<[A, B, ...]>` — Svelte snippet with a props-tuple argument. */
export const SVELTE_SNIPPET_TUPLE = /Snippet\s*<\s*\[([^\]]*)\]\s*>/g;

/** Matches a bare TS identifier inside a snippet tuple. */
export const IDENTIFIER = /[A-Za-z_$][\w$.]*/g;
