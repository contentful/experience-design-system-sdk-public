import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathExists } from '../../lib/path-exists.js';
import { die } from '../../lib/cli-errors.js';

export async function assertFileExists(flag: string, p: string): Promise<void> {
  if (!(await pathExists(p))) die(`Error: file not found: ${p} (from ${flag})`);
}

export async function readFileInline(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  const resolved = resolve(path);
  let s;
  try {
    s = await stat(resolved);
  } catch {
    return undefined;
  }
  if (!s.isDirectory()) return readFile(resolved, 'utf8');
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const full = join(dir, entry);
      let es;
      try {
        es = await stat(full);
      } catch {
        continue;
      }
      if (es.isDirectory()) {
        await walk(full);
      } else if (entry.endsWith('.json')) {
        files.push(full);
      }
    }
  }
  await walk(resolved);
  if (files.length === 0) return undefined;
  const parts = await Promise.all(files.map((f) => readFile(f, 'utf8').catch(() => '')));
  return parts.filter(Boolean).join('\n\n');
}
