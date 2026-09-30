import { statSync } from 'node:fs';
import { normalizePath } from '../../input/path.js';

/** Why a typed path was rejected, and the absolute path it resolved to, so the user can see what was checked. */
export interface TokenPathFailure {
  error: string;
  resolvedPath: string;
}

/** The outcome of checking the path the user typed. */
export type TokenPathCheck = { ok: true; path: string } | ({ ok: false } & TokenPathFailure);

/**
 * Resolve the typed text to an absolute path (quotes stripped, `~` expanded, relative paths resolved against the
 * working directory) and check that it is an existing regular file. This is the only place the screen touches the
 * filesystem; it runs when the user presses Enter, never while rendering, and it finishes before the screen reports
 * a result.
 */
export function validateTokenPath(rawPath: string): TokenPathCheck {
  const path = normalizePath(rawPath);

  let stats;
  try {
    stats = statSync(path);
  } catch {
    return { ok: false, error: `Path not found: ${path}`, resolvedPath: path };
  }

  if (stats.isDirectory()) {
    return {
      ok: false,
      error: "That's a directory — provide a path to a token file (e.g. tokens.json), not a folder.",
      resolvedPath: path,
    };
  }
  if (!stats.isFile()) {
    return { ok: false, error: `Not a regular file: ${path}`, resolvedPath: path };
  }
  return { ok: true, path };
}
