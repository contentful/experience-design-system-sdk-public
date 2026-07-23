/**
 * Pull the parser function source out of the agent's stdout (spec:
 * agent-authored-parser, Phase 2). Agents typically wrap code in a fenced
 * block, but often emit a non-parser block first (a JSON sample, prose). We
 * return the first block that is actually SHAPED like the contract — a
 * default-exported function taking one param — so a stray sample never reaches
 * the sandbox. Lenient by design: no parser-shaped source → null → caller
 * falls back.
 */
const FENCE = /```(?:[a-zA-Z]+)?\n([\s\S]*?)```/g;

/**
 * Cheap structural check that source matches the parser contract:
 * `export default` of a function (declaration or arrow) that takes at least
 * one parameter. Not a full parse — just enough to reject JSON samples, prose,
 * and no-arg functions before we spend a sandbox spawn on them.
 */
export function looksLikeParser(source: string): boolean {
  const s = source.trim();
  if (!/export\s+default\b/.test(s)) return false;
  // export default function [name] (param...) { ... }
  const fnDecl = /export\s+default\s+(?:async\s+)?function\b[^(]*\(\s*[A-Za-z_$][\w$]*/;
  // export default (param...) => ...   OR   export default param => ...
  const arrow = /export\s+default\s+(?:async\s+)?(?:\(\s*[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\s*=>)/;
  return fnDecl.test(s) || arrow.test(s);
}

export function extractParserSource(stdout: string): string | null {
  FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE.exec(stdout)) !== null) {
    const candidate = m[1].trim();
    if (candidate !== '' && looksLikeParser(candidate)) return candidate;
  }
  // No parser-shaped fenced block — accept bare source only if it, too, is
  // shaped like the contract.
  const idx = stdout.indexOf('export default');
  if (idx !== -1) {
    const bare = stdout.slice(idx).trim();
    if (looksLikeParser(bare)) return bare;
  }
  return null;
}
