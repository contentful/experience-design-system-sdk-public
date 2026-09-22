import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';
const TAGS_URL = 'https://api.github.com/repos/contentful/experience-design-system-sdk-public/tags?per_page=10';

// version.js is nested a few directories below the package root (e.g. dist/src/tui/upgrade/),
// so this has to walk up until it finds the manifest, not just check the immediate parent.
function findPackageRoot(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));

  while (true) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; version?: string };
      // Skip nested or unrelated manifests found on the way up.
      if (pkg.name === PACKAGE_NAME && pkg.version) return dir;
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

export type UpgradeCheckResult =
  | { status: 'update-available'; current: string; latest: string }
  | { status: 'up-to-date'; current: string }
  | { status: 'error' };

function parseVersionTag(tag: string): string | undefined {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  return match ? match[1] : undefined;
}

export async function checkForUpgrade(): Promise<UpgradeCheckResult> {
  const current = readPackageVersion();

  try {
    const response = await fetch(TAGS_URL);
    if (!response.ok) return { status: 'error' };

    const tags = (await response.json()) as { name?: string }[];
    const versions = tags
      .map((tag) => (tag.name ? parseVersionTag(tag.name) : undefined))
      .filter((v): v is string => v !== undefined);
    if (versions.length === 0) return { status: 'error' };

    const latest = versions.reduce((best, v) => (semver.gt(v, best) ? v : best));
    if (!semver.valid(current)) return { status: 'error' };

    if (semver.gt(latest, current)) {
      return { status: 'update-available', current, latest };
    }
    return { status: 'up-to-date', current };
  } catch {
    return { status: 'error' };
  }
}
