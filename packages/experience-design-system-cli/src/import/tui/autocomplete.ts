export interface AutocompleteResult {
  completion: string;
  candidates: string[];
}

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
