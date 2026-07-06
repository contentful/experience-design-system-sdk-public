import { homedir } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import { findAllRunsBySavePath, getRun, type RunRecord } from './store.js';

/**
 * Decide whether a positional CLI arg refers to a run-id or a filesystem path,
 * then look up the corresponding RunRecord.
 *
 * Mirrors `git checkout` accepting either a sha or a ref: anything that *looks
 * like* a path is treated as one; otherwise we fall back to a run-id lookup.
 *
 * Path detection: arg starts with `/`, `./`, `../`, or `~/`, OR equals `.`,
 * OR equals `~`.
 */
export async function resolveRunTarget(arg: string): Promise<RunRecord> {
  if (looksLikePath(arg)) {
    const absolute = resolvePath(expandHome(arg));
    const matches = await findAllRunsBySavePath(absolute);
    if (matches.length === 0) {
      throw new Error(`No run recorded for path ${absolute}. Run 'experiences runs' to list known runs.`);
    }
    if (matches.length === 1) {
      return matches[0]!;
    }
    // Multi-match: newest createdAt wins. ISO UTC timestamps compare
    // lexicographically (see store.ts: createdAt = new Date().toISOString()).
    const sorted = [...matches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const newest = sorted[0]!;
    const olderCount = matches.length - 1;
    process.stderr.write(
      `Multiple runs at ${absolute}; using newest ${newest.id} (createdAt ${newest.createdAt}). ${olderCount} older candidates ignored.\n`,
    );
    return newest;
  }
  return getRun(arg);
}

function looksLikePath(arg: string): boolean {
  if (arg === '.' || arg === '~') return true;
  return arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../') || arg.startsWith('~/');
}

function expandHome(arg: string): string {
  if (arg === '~') return homedir();
  if (arg.startsWith('~/')) return resolvePath(homedir(), arg.slice(2));
  return arg;
}
