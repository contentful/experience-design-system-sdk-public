export interface AllowedComponentsContext {
  /** e.g. { HeadingProps -> Heading, ButtonProps -> Button } */
  propsToComponent: ReadonlyMap<string, string>;
  /** ComponentType names known to the project (post-filter). */
  componentNames: ReadonlySet<string>;
}

// Matches ReactElement<XProps> and ReactElement<XProps, ...> (TS often
// expands the second generic argument to string | JSXElementConstructor<any>).
// Only the first generic argument (the props type name) is captured.
const REACT_ELEMENT_GENERIC = /(?:React\.)?ReactElement\s*<\s*([A-Za-z_$][\w$.]*)(?![\w$.])/g;

// Svelte 5 typed snippets: `Snippet<[XProps]>`. The type argument is a tuple
// listing render args; when a snippet is authored to render a nested
// ComponentType, the single tuple element is that component's Props type.
// We only match the single-element tuple form — non-props render args
// (e.g. `Snippet<[year: number]>`) don't reference a ComponentType and are
// filtered out below via propsToComponent lookup.
const SVELTE_SNIPPET_GENERIC = /Snippet\s*<\s*\[\s*([A-Za-z_$][\w$.]*)\s*\]\s*>/g;

export function extractAllowedComponentsFromTypeText(typeText: string, ctx: AllowedComponentsContext): string[] {
  const found = new Set<string>();
  for (const re of [REACT_ELEMENT_GENERIC, SVELTE_SNIPPET_GENERIC]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(typeText)) !== null) {
      const propsTypeName = m[1];
      const componentName = ctx.propsToComponent.get(propsTypeName);
      if (componentName && ctx.componentNames.has(componentName)) {
        found.add(componentName);
      }
    }
  }
  return [...found].sort();
}

const JSDOC_TAG = /@allowedComponents\s+([^\n*]+)/;

export function extractAllowedComponentsFromJsdoc(jsdocText: string, componentNames: ReadonlySet<string>): string[] {
  const m = JSDOC_TAG.exec(jsdocText);
  if (!m) return [];
  const found = new Set<string>();
  for (const raw of m[1].split(',')) {
    const name = raw.trim();
    if (name && componentNames.has(name)) found.add(name);
  }
  return [...found].sort();
}
