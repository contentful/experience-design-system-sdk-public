import { readdirSync, type Dirent } from 'node:fs';

/**
 * Read a directory's entries, returning `'unreadable'` instead of throwing
 * on permission errors / races. Lets the walker continue past one bad dir
 * instead of aborting the whole scan.
 */
export function readDirSafely(dir: string): Dirent[] | 'unreadable' {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return 'unreadable';
  }
}
