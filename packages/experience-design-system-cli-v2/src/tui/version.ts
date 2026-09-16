import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';

export function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      // Skip nested or unrelated manifests found on the way up.
      if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version;
    } catch {
      // No readable manifest here; keep walking.
    }

    const parent = dirname(dir);
    if (parent === dir) return 'unknown';
    dir = parent;
  }
}
