/**
 * Prompt + reply parser for the directory completeness critic. Cheap: the
 * agent sees only directory NAMES (no file contents) and returns which look
 * like they might hold composition/mapping declarations.
 */
import { loadPrompt } from './agent-parser/load-prompt.js';

export function buildDirCriticPrompt(dirs: string[]): string {
  return [loadPrompt('composition-dir-critic.md').trim(), '', 'Directories:', ...dirs.map((d) => `- ${d}`)].join('\n');
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
