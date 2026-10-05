import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Path to `<pkg>/bin/cli.js`. Walks up rather than hardcoding depth, so it survives src/dist/bundled layout changes. */
export function findCliPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'bin', 'cli.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback path; callers' existsSync checks surface a clear error if wrong.
  return join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'bin', 'cli.js');
}

/** Package root (contains bin/, dist/, package.json). Derived from findCliPath's anchor. */
export function findPkgRoot(): string {
  return dirname(dirname(findCliPath()));
}
