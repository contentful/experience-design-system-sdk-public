import type { CDFComponentEntry } from '../../../steps/shared/index.js';
import type { GeneratedCdf } from '../../types/prompts.js';

/**
 * Keeps only design-category, token-typed props per component (dropping
 * components left with none), alongside the distinct `$token.kind` values
 * seen among them and whether any such prop has no `$token.kind` at all.
 */
export function filterDesignTokenProps(cdf: GeneratedCdf): {
  filtered: GeneratedCdf;
  kinds: string[];
  hasUnscoped: boolean;
} {
  const result: GeneratedCdf = {};
  const kinds = new Set<string>();
  let hasUnscoped = false;

  for (const [componentName, component] of Object.entries(cdf)) {
    const properties = component.$properties;
    if (!properties) continue;
    const filteredProps: Record<string, CDFComponentEntry['$properties'][string]> = {};
    for (const [propName, prop] of Object.entries(properties)) {
      if (prop.$type === 'token' && prop.$category === 'design') {
        const { '$token.allowed': _tokenAllowed, ...rest } = prop;
        filteredProps[propName] = rest;
        const kind = prop['$token.kind'];
        if (typeof kind === 'string' && kind.length > 0) kinds.add(kind);
        else hasUnscoped = true;
      }
    }
    if (Object.keys(filteredProps).length > 0) {
      result[componentName] = { ...component, $properties: filteredProps };
    }
  }

  return { filtered: result, kinds: [...kinds].sort(), hasUnscoped };
}
