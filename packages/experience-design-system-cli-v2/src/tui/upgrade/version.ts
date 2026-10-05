import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { findPackageRoot } from '../package-root.js';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';
const TAGS_URL = 'https://api.github.com/repos/contentful/experience-design-system-sdk-public/tags?per_page=10';

export function readPackageVersion(): string {
  const root = findPackageRoot(import.meta.url, PACKAGE_NAME);
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
