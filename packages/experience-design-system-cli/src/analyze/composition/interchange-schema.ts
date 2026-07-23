/**
 * The CLI-owned composition interchange format (spec T1).
 *
 * Two views of the same data:
 *  - `InterchangeMap` — the human-authored / on-disk `{ version, groups }`
 *    shape (parent → children). This is what `--composition-map` consumes and
 *    `--generate-map` emits.
 *  - `CompositionEdge[]` — the flat internal runtime view, one edge per
 *    parent→child relationship, carrying optional `slot` (T7), `confidence`,
 *    and `provenance`. Easier to merge/dedupe across sources (T2).
 *
 * This module owns both shapes and the converters between them.
 */

export type EdgeProvenance = 'user' | 'typed-slot' | `adapter:${string}` | 'agent';

export type CompositionEdge = {
  parent: string;
  child: string;
  /** Optional named slot (T7). Default slot when omitted. */
  slot?: string;
  /** 1–5 scale, same as select/reject agent tools. */
  confidence?: number;
  provenance: EdgeProvenance;
};

export type InterchangeMap = {
  version: 1;
  groups: Record<string, string[]>;
};

export type ValidateResult = { valid: true; map: InterchangeMap } | { valid: false; errors: string[] };

export function validateInterchangeMap(input: unknown): ValidateResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: ['interchange map must be a JSON object'] };
  }
  const obj = input as Record<string, unknown>;
  if (obj.version !== 1) {
    errors.push(`unsupported interchange version: expected 1, got ${JSON.stringify(obj.version)}`);
  }
  if (typeof obj.groups !== 'object' || obj.groups === null || Array.isArray(obj.groups)) {
    errors.push('interchange map must have a `groups` object');
    return { valid: false, errors };
  }
  const groups = obj.groups as Record<string, unknown>;
  for (const [parent, children] of Object.entries(groups)) {
    if (!Array.isArray(children) || !children.every((c) => typeof c === 'string')) {
      errors.push(`groups["${parent}"] must be an array of strings`);
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, map: { version: 1, groups: groups as Record<string, string[]> } };
}

export function groupsToEdges(map: InterchangeMap, provenance: EdgeProvenance): CompositionEdge[] {
  const seen = new Set<string>();
  const edges: CompositionEdge[] = [];
  for (const [parent, children] of Object.entries(map.groups)) {
    for (const child of children) {
      const key = `${parent}::${child}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ parent, child, provenance });
    }
  }
  return edges;
}

export function edgesToGroups(edges: CompositionEdge[]): InterchangeMap {
  const groups: Record<string, Set<string>> = {};
  for (const { parent, child } of edges) {
    (groups[parent] ??= new Set()).add(child);
  }
  const out: Record<string, string[]> = {};
  for (const parent of Object.keys(groups).sort()) {
    out[parent] = [...groups[parent]].sort();
  }
  return { version: 1, groups: out };
}
