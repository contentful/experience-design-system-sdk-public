/**
 * L4 (lifecycle-and-lineage plan §4) — shell-style Tab autocomplete for the
 * search input in ScopeGateStep and GenerateReviewStep.
 *
 * Supersedes the T3 first-alphabetical single-jump Tab behavior. Modeled on
 * shell `cd <partial><Tab>`: complete to the longest common prefix of all
 * prefix-matching candidates, and (when more than one candidate) surface the
 * list of possibilities so the user can disambiguate.
 *
 * Pure + fully unit-testable — no React, no side effects. Both step Tab
 * handlers call `computeAutocomplete`, set `searchQuery = result.completion`,
 * and stash `result.candidates` for a possibilities strip.
 *
 * Prefix semantics (case-insensitive) are intentional — NOT fuzzy. The `[n]`
 * match-cycle (which IS fuzzy, from T3) is a separate, preserved code path.
 */

export interface AutocompleteResult {
  /**
   * The new query value:
   *  - 0 candidates → the query unchanged.
   *  - 1 candidate → that candidate's full name.
   *  - >1 candidates → the longest common prefix of all candidates,
   *    case-preserved from the first candidate. Never shorter than `query`.
   */
  completion: string;
  /**
   * Names to display in the possibilities strip. Empty when there are 0 or 1
   * candidates (nothing to disambiguate). Sorted when populated.
   */
  candidates: string[];
}

/**
 * Longest common prefix of a non-empty list of strings, compared
 * case-insensitively but returned case-preserving from `names[0]`.
 */
function longestCommonPrefix(names: string[]): string {
  if (names.length === 0) return '';
  let prefixLen = names[0].length;
  for (let i = 1; i < names.length; i++) {
    const other = names[i];
    let j = 0;
    while (
      j < prefixLen &&
      j < other.length &&
      names[0][j].toLowerCase() === other[j].toLowerCase()
    ) {
      j++;
    }
    prefixLen = j;
    if (prefixLen === 0) break;
  }
  return names[0].slice(0, prefixLen);
}

/**
 * Compute shell-style autocomplete for `query` over `names`.
 *
 * Candidates = names where `name.toLowerCase().startsWith(query.toLowerCase())`.
 *  - 0 candidates → `{ completion: query, candidates: [] }`.
 *  - 1 candidate  → `{ completion: <full name>, candidates: [] }`.
 *  - >1 candidates → `{ completion: <LCP, case-preserved>, candidates: <sorted> }`.
 *
 * The completion is guaranteed to be at least as long as `query` (the LCP of
 * prefix-matches can never be shorter than the shared prefix they all start
 * with, but casing differences are guarded here so we never regress length).
 */
export function computeAutocomplete(query: string, names: string[]): AutocompleteResult {
  const q = query.toLowerCase();
  const candidates = names.filter((n) => n.toLowerCase().startsWith(q));

  if (candidates.length === 0) {
    return { completion: query, candidates: [] };
  }
  if (candidates.length === 1) {
    return { completion: candidates[0], candidates: [] };
  }

  const lcp = longestCommonPrefix(candidates);
  // Guard: never return a completion shorter than the current query (e.g. if
  // casing differences shrank the LCP below the typed length, keep the query).
  const completion = lcp.length >= query.length ? lcp : query;
  const sorted = [...candidates].sort();
  return { completion, candidates: sorted };
}
