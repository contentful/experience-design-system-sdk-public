import type { CompositionEdge } from '../interchange-schema.js';
import type { AdapterInput, CompositionAdapter } from './types.js';

/**
 * Collapse a component identifier to a case/separator-insensitive key so a
 * kebab tag-name and its PascalCase class name compare equal:
 *   'p-tabs' -> 'ptabs', 'PTabs' -> 'ptabs', 'p_tabs' -> 'ptabs'.
 */
function canonical(name: string): string {
  return name.replace(/[-_\s]/g, '').toLowerCase();
}

/**
 * Resolve a raw identifier (often a tag-name like `p-tabs`) to a name present
 * in `componentNames`. Prefers an exact match; otherwise falls back to a
 * PascalCase↔kebab (case/separator-insensitive) match. Returns undefined if
 * nothing matches so the caller can drop the edge.
 */
export function normalizeToComponentName(raw: string, componentNames: Set<string>): string | undefined {
  if (componentNames.has(raw)) return raw;
  const key = canonical(raw);
  for (const candidate of componentNames) {
    if (canonical(candidate) === key) return candidate;
  }
  return undefined;
}

// `@Component({ tag: 'p-tab-item' })` — Stencil-style tag decorator.
const COMPONENT_TAG_DECORATOR = /@Component\s*\(\s*\{[^}]*\btag\s*:\s*['"]([^'"]+)['"]/;
// A bare `tagName = 'p-foo'` / `tagName: 'p-foo'` class field.
const TAG_NAME_FIELD = /\btagName\s*[:=]\s*['"]([^'"]+)['"]/;
// `export class Foo` / `export const Foo` / `export function Foo`.
const EXPORTED_DECL = /export\s+(?:default\s+)?(?:abstract\s+)?(?:class|const|function)\s+([A-Za-z_$][\w$]*)/;
// `class Foo` (non-exported fallback).
const CLASS_DECL = /\bclass\s+([A-Za-z_$][\w$]*)/;

/** Best-effort: derive the declaring (child) component's identifier from a file. */
function inferChildName(content: string): string | undefined {
  return (
    COMPONENT_TAG_DECORATOR.exec(content)?.[1] ??
    TAG_NAME_FIELD.exec(content)?.[1] ??
    EXPORTED_DECL.exec(content)?.[1] ??
    CLASS_DECL.exec(content)?.[1]
  );
}

// `requiredParent` value: either an array literal or a single string literal.
const REQUIRED_PARENT_ARRAY = /\brequiredParent\s*(?::[^=]+)?=?\s*:?\s*\[([^\]]*)\]/;
const REQUIRED_PARENT_SINGLE = /\brequiredParent\s*(?::\s*[^=;\n]+)?[:=]\s*['"]([^'"]+)['"]/;
const STRING_LITERAL = /['"]([^'"]+)['"]/g;

/** Extract the raw parent tag-name(s) declared by `requiredParent` in a file. */
function extractRequiredParents(content: string): string[] {
  const arrayMatch = REQUIRED_PARENT_ARRAY.exec(content);
  if (arrayMatch) {
    const parents: string[] = [];
    STRING_LITERAL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STRING_LITERAL.exec(arrayMatch[1])) !== null) parents.push(m[1]);
    return parents;
  }
  const singleMatch = REQUIRED_PARENT_SINGLE.exec(content);
  if (singleMatch) return [singleMatch[1]];
  return [];
}

/**
 * v1 built-in adapter: inverts the Porsche-style `requiredParent` convention.
 * A CHILD component declares its allowed parent(s); we emit parent→child edges.
 * Deterministic, so confidence is pinned at 5.
 */
export const requiredParentAdapter: CompositionAdapter = (ctx: AdapterInput): CompositionEdge[] => {
  const edges: CompositionEdge[] = [];
  const seen = new Set<string>();

  for (const file of ctx.files) {
    const rawParents = extractRequiredParents(file.content);
    if (rawParents.length === 0) continue;

    const rawChild = inferChildName(file.content);
    if (!rawChild) continue;

    const child = normalizeToComponentName(rawChild, ctx.componentNames);
    if (!child) continue;

    for (const rawParent of rawParents) {
      const parent = normalizeToComponentName(rawParent, ctx.componentNames);
      if (!parent) continue;
      const key = `${parent}::${child}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ parent, child, provenance: 'adapter:required-parent', confidence: 5 });
    }
  }

  return edges;
};
