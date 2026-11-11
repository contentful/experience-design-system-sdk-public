// Small facts about a list of components that more than one step's debug log states.

type Suggested = { name: string; aiDecision?: 'accepted' | 'rejected' | 'failed' | null };

/** The names that appear more than once. The pipeline gives such components one decision, so they are worth saying. */
export function repeatedNames(names: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([name]) => name);
}

/** The components split by what the selection agent suggested. A failed or missing suggestion is "no suggestion". */
export function byAiSuggestion(components: readonly Suggested[]): {
  accepted: string[];
  rejected: string[];
  none: string[];
} {
  const out = { accepted: [] as string[], rejected: [] as string[], none: [] as string[] };
  for (const { name, aiDecision } of components) {
    if (aiDecision === 'accepted') out.accepted.push(name);
    else if (aiDecision === 'rejected') out.rejected.push(name);
    else out.none.push(name);
  }
  return out;
}
