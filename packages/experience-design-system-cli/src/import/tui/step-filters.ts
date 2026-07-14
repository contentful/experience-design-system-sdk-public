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

import { fuzzyMatches } from '../../analyze/fuzzy-search.js';

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

/**
 * FB1 (lifecycle-and-lineage plan §12) — build the flat-view dim predicate.
 *
 * Grouped view HIDES non-matching rows (via `filterVisibleKeys` in
 * `buildVisibleRows`); flat view never hides — it DIMS non-matching rows,
 * the same visual language search already uses. Before this, flat view only
 * dimmed search non-matches, so toggling `[w]`/`[o]`/`[i]` highlighted the
 * legend key without changing the sidebar. This folds the active filter/
 * focus-lineage key set (`filterVisibleKeys`, already the union of category
 * filters ∩ search, or the `[i]` ancestor set) into the flat dim so the
 * active-highlight tells the truth.
 *
 * Search dimming applies in BOTH views (grouped surviving neighborhood rows
 * that aren't direct fuzzy matches still dim — unchanged). Filter/focus-lineage
 * dimming is flat-view ONLY, since grouped view hides those non-matches
 * outright.
 *
 * Returns:
 *  - `undefined` when nothing would dim: no search AND (grouped view, or no
 *    filter/focus-lineage set in flat view).
 *  - a predicate otherwise that dims a name when a search is active AND it is
 *    not a fuzzy match, OR (flat view) a filter/focus-lineage set is active
 *    AND the name is not a member. The constraints OR together so any active
 *    narrowing dims its non-matches; matches of either stay bright.
 */
export function buildFlatDimPredicate(input: {
  viewMode: 'grouped' | 'flat';
  searchQuery: string;
  filterVisibleKeys: Set<string> | undefined;
}): ((componentKey: string) => boolean) | undefined {
  const hasSearch = input.searchQuery.length > 0;
  const isFlat = input.viewMode === 'flat';
  const keys = isFlat ? input.filterVisibleKeys : undefined;
  if (!hasSearch && keys === undefined) return undefined;
  return (name: string): boolean => {
    if (hasSearch && !fuzzyMatches(input.searchQuery, name)) return true;
    if (keys !== undefined && !keys.has(name)) return true;
    return false;
  };
}
