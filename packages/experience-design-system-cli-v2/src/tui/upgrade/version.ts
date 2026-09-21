import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';
const TAGS_URL = 'https://api.github.com/repos/contentful/experience-design-system-sdk-public/tags?per_page=10';

function findPackageRoot(): string | undefined {
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
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function readPackageVersion(): string {
  const root = findPackageRoot();
  if (!root) return 'unknown';

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? 'unknown';
}

/**
 * A source checkout runs straight out of `packages/experience-design-system-cli-v2`
 * in the monorepo, not out of a `node_modules` install (global or workspace-symlinked).
 */
export function isSourceCheckout(): boolean {
  const root = findPackageRoot();
  return root !== undefined && !root.includes('node_modules');
}

export type UpgradeCheckResult =
  | { status: 'update-available'; current: string; latest: string }
  | { status: 'up-to-date'; current: string }
  | { status: 'error' };

function parseVersionTag(tag: string): [number, number, number] | undefined {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionTuples(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

export async function checkForUpgrade(): Promise<UpgradeCheckResult> {
  const current = readPackageVersion();

  try {
    const response = await fetch(TAGS_URL);
    if (!response.ok) return { status: 'error' };

    const tags = (await response.json()) as { name?: string }[];
    const versions = tags
      .map((tag) => (tag.name ? parseVersionTag(tag.name) : undefined))
      .filter((v): v is [number, number, number] => v !== undefined);
    if (versions.length === 0) return { status: 'error' };

    const latestTuple = versions.reduce((best, v) => (compareVersionTuples(v, best) > 0 ? v : best));
    const currentTuple = parseVersionTag(`v${current}`);
    if (!currentTuple) return { status: 'error' };

    const latest = latestTuple.join('.');
    if (compareVersionTuples(latestTuple, currentTuple) > 0) {
      return { status: 'update-available', current, latest };
    }
    return { status: 'up-to-date', current };
  } catch {
    return { status: 'error' };
  }
}
