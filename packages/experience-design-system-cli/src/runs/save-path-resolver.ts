import { access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The set of files the wizard / CLI may overwrite in the save directory.
 * Centralised so conflict detection and conflict reporting stay in lock-step.
 */
const SAVE_FILES = ['components.json', 'tokens.json'] as const;

/**
 * Returns the subset of `SAVE_FILES` that already exist at `path`. Order is
 * stable so test assertions can reason about it.
 */
async function listConflictingFiles(path: string): Promise<string[]> {
  const conflicts: string[] = [];
  for (const name of SAVE_FILES) {
    try {
      await access(join(path, name));
      conflicts.push(name);
    } catch {
      // ENOENT — file not present, keep checking the others.
    }
  }
  return conflicts;
}

/**
 * Returns true if `components.json` or `tokens.json` already exists at `path`.
 * Used by the wizard to decide whether to render the save-conflict gate before
 * writing.
 */
export async function detectSaveConflict(path: string): Promise<boolean> {
  return (await listConflictingFiles(path)).length > 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Build a timestamped subdirectory under `base` for the "new" branch of the
 * save-conflict gate. Format: `<base>/dsi-YYYYMMDD-HHMMSS` (local time).
 */
export function buildTimestampedSubdir(base: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  return join(base, `dsi-${y}${m}${d}-${hh}${mm}${ss}`);
}
