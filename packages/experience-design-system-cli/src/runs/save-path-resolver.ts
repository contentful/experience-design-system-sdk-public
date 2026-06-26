import { access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Returns true if `components.json` or `tokens.json` already exists at `path`.
 * Used by the wizard to decide whether to render the save-conflict gate before
 * writing.
 */
export async function detectSaveConflict(path: string): Promise<boolean> {
  for (const name of ['components.json', 'tokens.json']) {
    try {
      await access(join(path, name));
      return true;
    } catch {
      // ENOENT — keep checking the other file.
    }
  }
  return false;
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

export type ResolveSavePathResult =
  | { kind: 'no-conflict'; path: string }
  | { kind: 'conflict'; path: string };

/**
 * Probe the requested save path and report whether the wizard needs to render
 * the conflict gate.
 */
export async function resolveSavePath(path: string): Promise<ResolveSavePathResult> {
  const conflict = await detectSaveConflict(path);
  return conflict ? { kind: 'conflict', path } : { kind: 'no-conflict', path };
}
