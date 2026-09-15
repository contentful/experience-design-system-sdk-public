import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';

/**
 * Version from this package's own package.json.
 *
 * Walks up from the current module looking for the package manifest rather than
 * assuming a fixed depth: the bundle sits in `dist/` (one level below the
 * manifest) while the source modules sit deeper, so a single relative path is
 * right in one context and throws in the other.
 */
export function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      // Guard against picking up a nested or unrelated manifest on the way up.
      if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version;
    } catch {
      // No readable manifest here; keep walking.
    }

    const parent = dirname(dir);
    if (parent === dir) return 'unknown';
    dir = parent;
  }
}
