import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';

function findPackageRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      // Skip nested or unrelated manifests found on the way up.
      if (pkg.name === PACKAGE_NAME && pkg.version) return dir;
    } catch {
      // No readable manifest here; keep walking.
    }

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readPackageVersion(): string {
  const root = findPackageRoot();
  if (!root) return 'unknown';
  const raw = readFileSync(join(root, 'package.json'), 'utf8');
  return (JSON.parse(raw) as { version?: string }).version ?? 'unknown';
}

/**
 * True when the running code's package root lives outside any node_modules
 * tree — a pnpm workspace symlink or a direct source checkout, as opposed to
 * an npm/pnpm global install. `npm install -g` writes into npm's global
 * node_modules and can never change what a checkout-linked binary reads, so
 * the upgrade flow must not offer to "upgrade" in that case.
 */
export function isSourceCheckout(): boolean {
  const root = findPackageRoot();
  return root !== null && !root.split(sep).includes('node_modules');
}
