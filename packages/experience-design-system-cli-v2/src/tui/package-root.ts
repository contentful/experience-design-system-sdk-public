import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks up from `startUrl` looking for the outermost ancestor directory whose
 * `package.json` has `name === packageName`. Keeps walking past the first
 * match instead of stopping there, because the built CLI's `dist/package.json`
 * is an unmodified copy of the root manifest and shares the same `name` —
 * stopping at the first match would land on `dist/` instead of the real
 * package root. Falls back to the filesystem root if no manifest is found.
 */
export function findPackageRoot(startUrl: string, packageName: string): string {
  let dir = dirname(fileURLToPath(startUrl));
  let found: string | undefined;

  while (true) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
      if (pkg.name === packageName) found = dir;
    }

    const parent = dirname(dir);
    if (parent === dir) return found ?? dir;
    dir = parent;
  }
}
