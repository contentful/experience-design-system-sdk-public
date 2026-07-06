export interface AllowedComponentsContext {
  /** e.g. { HeadingProps -> Heading, ButtonProps -> Button } */
  propsToComponent: ReadonlyMap<string, string>;
  /** ComponentType names known to the project (post-filter). */
  componentNames: ReadonlySet<string>;
}

const REACT_ELEMENT_GENERIC = /(?:React\.)?ReactElement\s*<\s*([A-Za-z_$][\w$.]*)\s*>/g;

export function extractAllowedComponentsFromTypeText(
  typeText: string,
  ctx: AllowedComponentsContext
): string[] {
  const stripped = typeText
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s !== 'null' && s !== 'undefined')
    .join(' | ');

  const found = new Set<string>();
  let m: RegExpExecArray | null;
  REACT_ELEMENT_GENERIC.lastIndex = 0;
  while ((m = REACT_ELEMENT_GENERIC.exec(stripped)) !== null) {
    const propsTypeName = m[1];
    const componentName = ctx.propsToComponent.get(propsTypeName);
    if (componentName && ctx.componentNames.has(componentName)) {
      found.add(componentName);
    }
  }
  return [...found].sort();
}

const JSDOC_TAG = /@allowedComponents\s+([^\n*]+)/;

export function extractAllowedComponentsFromJsdoc(
  jsdocText: string,
  componentNames: ReadonlySet<string>
): string[] {
  const m = JSDOC_TAG.exec(jsdocText);
  if (!m) return [];
  const found = new Set<string>();
  for (const raw of m[1].split(',')) {
    const name = raw.trim();
    if (name && componentNames.has(name)) found.add(name);
  }
  return [...found].sort();
}
