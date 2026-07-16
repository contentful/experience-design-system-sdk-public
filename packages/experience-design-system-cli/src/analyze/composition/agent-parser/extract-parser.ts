/**
 * Pull the parser function source out of the agent's stdout (spec:
 * agent-authored-parser, Phase 2). Agents typically wrap code in a fenced
 * block; fall back to bare `export default` source. Lenient by design — like
 * the JSONL tool-call parser, a miss returns null and the caller falls back.
 */
const FENCE = /```(?:[a-zA-Z]+)?\n([\s\S]*?)```/;

export function extractParserSource(stdout: string): string | null {
  const fenced = FENCE.exec(stdout);
  if (fenced && fenced[1].trim() !== '') {
    return fenced[1].trim();
  }
  // No fence — accept bare source only if it declares the expected export.
  const idx = stdout.indexOf('export default');
  if (idx !== -1) {
    return stdout.slice(idx).trim();
  }
  return null;
}
