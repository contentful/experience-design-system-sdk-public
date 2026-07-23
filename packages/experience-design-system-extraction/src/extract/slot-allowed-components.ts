export interface AllowedComponentsContext {
  propsToComponent: ReadonlyMap<string, string>;
  componentNames: ReadonlySet<string>;
}

// Matches ReactElement<XProps> and ReactElement<XProps, ...> (TS often
// expands the second generic argument to string | JSXElementConstructor<any>).
// Only the first generic argument (the props type name) is captured.
const REACT_ELEMENT_GENERIC = /(?:React\.)?ReactElement\s*<\s*([A-Za-z_$][\w$.]*)(?![\w$.])/g;

const SVELTE_SNIPPET_TUPLE = /Snippet\s*<\s*\[([^\]]*)\]\s*>/g;
const IDENTIFIER = /[A-Za-z_$][\w$.]*/g;

export function extractAllowedComponentsFromTypeText(typeText: string, ctx: AllowedComponentsContext): string[] {
  const found = new Set<string>();
  const record = (propsTypeName: string): void => {
    const componentName = ctx.propsToComponent.get(propsTypeName);
    if (componentName && ctx.componentNames.has(componentName)) found.add(componentName);
  };

  REACT_ELEMENT_GENERIC.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REACT_ELEMENT_GENERIC.exec(typeText)) !== null) record(m[1]);

  SVELTE_SNIPPET_TUPLE.lastIndex = 0;
  while ((m = SVELTE_SNIPPET_TUPLE.exec(typeText)) !== null) {
    const tupleBody = m[1];
    IDENTIFIER.lastIndex = 0;
    let id: RegExpExecArray | null;
    while ((id = IDENTIFIER.exec(tupleBody)) !== null) record(id[0]);
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
