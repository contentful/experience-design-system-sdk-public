import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Expand a leading `~` to the user's home directory. */
export function expandTilde(input: string): string {
  if (input === '~' || input.startsWith('~/') || input.startsWith('~\\')) {
    return homedir() + input.slice(1);
  }
  return input;
}

/**
 * Turn a path as a user types or pastes it into an absolute path: surrounding quotes are stripped, `~` is expanded,
 * relative paths are resolved against the working directory. Shared by every import screen that asks for a path.
 */
export function normalizePath(input: string): string {
  let path = input.trim();

  if (
    path.length >= 2 &&
    ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'")))
  ) {
    path = path.slice(1, -1);
  }

  return resolve(expandTilde(path));
}
