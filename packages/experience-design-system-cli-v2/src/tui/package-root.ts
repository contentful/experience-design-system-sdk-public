import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks up from `startUrl` looking for the nearest ancestor directory whose
 * `package.json` has `name === packageName`. Falls back to the filesystem
 * root if no such manifest is found on the way up.
 */
export function findPackageRoot(startUrl: string, packageName: string): string {
  let dir = dirname(fileURLToPath(startUrl));

  while (true) {
    const raw = readFileSync(join(dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name?: string };
    if (pkg.name === packageName) return dir;

    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}
