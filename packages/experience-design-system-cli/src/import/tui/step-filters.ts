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

export function intersectFilterKeys(a: Set<string> | undefined, b: Set<string> | undefined): Set<string> | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const out = new Set<string>();
  for (const k of a) if (b.has(k)) out.add(k);
  return out;
}

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
