/**
 * L8 (lifecycle-and-lineage plan §5 L8) — category filters for the sidebar in
 * ScopeGateStep and GenerateReviewStep.
 *
 * The operator toggles per-category filters (broken / cycles / deleted). Each
 * filter contributes a set of component keys; when multiple filters are active
 * their key sets are UNION-ed (a component shows if it matches ANY active
 * filter). The result is fed into the existing `filterVisibleKeys` plumbing
 * that `buildVisibleRows` already consumes — grouped view hides non-matching
 * rows, flat view dims them.
 *
 * Pure + fully unit-testable — no React, no side effects. Each step passes its
 * own data (cycle set, broken set, and — GenerateReview only — deleted set).
 *
 * Per-step applicability:
 *  - `cycles`  — both steps (ScopeGate cycleParticipants, GR cycleView.structural)
 *  - `broken`  — both steps (ScopeGate AI-flagged/warning, GR directIssues non-ok)
 *  - `deleted` — GenerateReview ONLY (removedComponents). ScopeGate has no
 *    deleted concept, so it never supplies a `deleted` set or activates the
 *    filter.
 */

export type FilterCategory = 'broken' | 'cycles' | 'deleted';

export interface FilterDataSources {
  /** Component keys that participate in a slot cycle. */
  cycles?: Iterable<string>;
  /** Component keys the step considers "broken" (issue/warning/AI-flagged). */
  broken?: Iterable<string>;
  /** Component keys marked for deletion (GenerateReview only). */
  deleted?: Iterable<string>;
}

/**
 * Compute the union of component keys matching the active category filters.
 *
 * @returns
 *  - `undefined` when no filter is active (the caller should leave the existing
 *    jump/search logic untouched — an inactive filter must never narrow the
 *    list).
 *  - a `Set<string>` (possibly empty) of every key matching ANY active filter
 *    otherwise. An active filter whose data source is missing/empty contributes
 *    nothing, so a single active filter with zero matches yields an empty set —
 *    the caller renders a graceful "no matches" state, never crashes.
 */
export function computeFilterKeys(input: {
  filters: Iterable<FilterCategory>;
  data: FilterDataSources;
}): Set<string> | undefined {
  const active = new Set(input.filters);
  if (active.size === 0) return undefined;
  const out = new Set<string>();
  if (active.has('cycles')) for (const k of input.data.cycles ?? []) out.add(k);
  if (active.has('broken')) for (const k of input.data.broken ?? []) out.add(k);
  if (active.has('deleted')) for (const k of input.data.deleted ?? []) out.add(k);
  return out;
}

/**
 * Intersect a category-filter key set with the existing search-neighborhood
 * key set. Used when BOTH a category filter and a search are active: the
 * sidebar shows components that satisfy BOTH (matched by a filter AND surviving
 * the search neighborhood). Either being `undefined` means that constraint is
 * inactive, so the other is returned as-is.
 */
export function intersectFilterKeys(
  a: Set<string> | undefined,
  b: Set<string> | undefined,
): Set<string> | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const out = new Set<string>();
  for (const k of a) if (b.has(k)) out.add(k);
  return out;
}
