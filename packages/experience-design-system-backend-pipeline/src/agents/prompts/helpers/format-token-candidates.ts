/** One line per candidate, e.g. `colors.brand.primary · color` — legible and countable, unlike nested JSON. */
export function formatTokenCandidateLines(entries: Array<{ path: string; $type?: unknown }>): string {
  return entries.map((entry) => `${entry.path} · ${entry.$type}`).join('\n');
}

/** Renders one kind-scoped (or, for `kind: null`, full-tree) candidate section. */
export function renderTokenCandidateSection(
  kind: string | null,
  entries: Array<{ path: string; $type?: unknown }>,
): string {
  const label = kind
    ? `Token path index — ${kind} candidates only`
    : 'Token path index — full tree (no $token.kind to scope by)';
  return `${label}, one leaf token per line as \`path · type\`, no \`$value\`:\n${formatTokenCandidateLines(entries)}`;
}
