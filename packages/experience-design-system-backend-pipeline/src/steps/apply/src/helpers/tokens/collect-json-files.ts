import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const IGNORE_TOKEN_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', '.git']);

/** Recursively walk `dir`; return absolute paths of every `.json` file (depth-first, deterministic). */
export async function collectJsonFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  await walk(dir, results);
  return results;
}

async function walk(current: string, results: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(current);
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (IGNORE_TOKEN_DIRS.has(entry)) return;
      const full = join(current, entry);
      let s;
      try {
        s = await stat(full);
      } catch {
        return;
      }
      if (s.isDirectory()) {
        await walk(full, results);
      } else if (entry.endsWith('.json')) {
        results.push(full);
      }
    }),
  );
}
