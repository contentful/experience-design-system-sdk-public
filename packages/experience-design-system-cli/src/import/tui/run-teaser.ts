/**
 * Task 8 — one-line teaser appended at the end of every successful run.
 * Format pinned in dsi-tui-local-save-tooling-spec.md Part 6.
 */
export function buildRunTeaserLine(runId: string | null | undefined): string {
  if (!runId) return '';
  return `Run saved as ${runId} — replay with 'experiences import --from-run ${runId}' or modify with 'experiences import --from-run ${runId} --modify'.`;
}
