import { resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Expands a leading `~` to the user's home directory.
 * Exported separately so it can be unit-tested and reused.
 */
export function expandTilde(input: string): string {
  if (input === '~' || input.startsWith('~/') || input.startsWith('~\\')) {
    return homedir() + input.slice(1);
  }
  return input;
}

/**
 * Normalizes a user-entered path to an absolute path, handling all common
 * terminal path styles:
 *   - surrounding quotes ("~/path" or '~/path')  → stripped
 *   - tilde prefix (~/projects/mylib)             → expanded to $HOME
 *   - relative paths (../mylib, ./src, mylib)     → resolved against CWD
 *   - absolute paths (/Users/ryun/projects/mylib) → passed through
 *   - trailing slashes, repeated slashes          → normalized by path.resolve
 */
export function normalizePath(input: string): string {
  let p = input.trim();

  // strip surrounding single or double quotes
  if (p.length >= 2 && ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")))) {
    p = p.slice(1, -1);
  }

  p = expandTilde(p);

  return resolve(p);
}
