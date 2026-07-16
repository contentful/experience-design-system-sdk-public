/**
 * Prompt + reply parser for the directory completeness critic. Cheap: the
 * agent sees only directory NAMES (no file contents) and returns which look
 * like they might hold composition/mapping declarations.
 */

export function buildDirCriticPrompt(dirs: string[]): string {
  return [
    'These directories were NOT selected as composition candidates by a keyword filter.',
    'Judging by the PATH/NAME alone, which (if any) might contain component composition,',
    'mapping, or parent→child relationship declarations worth inspecting? Be selective —',
    'skip obvious utilities, tests, styles, and unrelated feature code.',
    '',
    'Reply with ONLY a JSON array of the directory strings to include, e.g. ["src/registry"].',
    'Use [] if none look relevant. Copy the strings exactly as listed.',
    '',
    'Directories:',
    ...dirs.map((d) => `- ${d}`),
  ].join('\n');
}

/**
 * Parse the agent's reply into the chosen directories, keeping only ones that
 * were offered (no injection). Lenient: extracts the first JSON array from
 * surrounding prose; malformed / absent → [].
 */
export function parseDirCriticReply(reply: string, offered: string[]): string[] {
  const start = reply.indexOf('[');
  const end = reply.indexOf(']', start);
  if (start === -1 || end === -1) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const offeredSet = new Set(offered);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    if (typeof v === 'string' && offeredSet.has(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
