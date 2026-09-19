import semver from 'semver';
import { readPackageVersion, isSourceCheckout } from '../../version.js';

const TAGS_URL = 'https://api.github.com/repos/contentful/experience-design-system-sdk-public/tags?per_page=10';

export type UpgradeCheckResult =
  | { status: 'update-available'; current: string; latest: string }
  | { status: 'up-to-date'; current: string }
  | { status: 'source-checkout'; current: string }
  | { status: 'error' };

export function getCurrentVersion(): string {
  return readPackageVersion();
}

export async function checkForUpgrade(): Promise<UpgradeCheckResult> {
  const current = getCurrentVersion();

  if (isSourceCheckout()) {
    return { status: 'source-checkout', current };
  }

  try {
    const response = await fetch(TAGS_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return { status: 'error' };
    }

    const tags = (await response.json()) as { name: string }[];
    const latest = tags
      .map((tag) => semver.valid(semver.coerce(tag.name)))
      .filter((version): version is string => version !== null)
      .sort(semver.rcompare)[0];

    if (!latest || !semver.valid(current)) {
      return { status: 'error' };
    }

    if (semver.gt(latest, current)) {
      return { status: 'update-available', current, latest };
    }
    return { status: 'up-to-date', current };
  } catch {
    return { status: 'error' };
  }
}
