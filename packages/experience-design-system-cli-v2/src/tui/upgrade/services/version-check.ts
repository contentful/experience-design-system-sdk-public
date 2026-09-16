import { readPackageVersion } from '../../version.js';

const TAGS_URL = 'https://api.github.com/repos/contentful/experience-design-system-sdk-public/tags?per_page=10';

export type UpgradeCheckResult =
  | { status: 'update-available'; current: string; latest: string }
  | { status: 'up-to-date'; current: string }
  | { status: 'error' };

export function getCurrentVersion(): string {
  return readPackageVersion();
}

export function parseVersionTag(tag: string): [number, number, number] | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

export async function checkForUpgrade(): Promise<UpgradeCheckResult> {
  const current = getCurrentVersion();

  try {
    const response = await fetch(TAGS_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return { status: 'error' };
    }

    const tags = (await response.json()) as { name: string }[];
    let latestTuple: [number, number, number] | null = null;
    let latestTag = '';
    for (const tag of tags) {
      const parsed = parseVersionTag(tag.name);
      if (!parsed) {
        continue;
      }
      if (!latestTuple || compareVersions(parsed, latestTuple) > 0) {
        latestTuple = parsed;
        latestTag = tag.name;
      }
    }

    if (!latestTuple) {
      return { status: 'error' };
    }

    const currentTuple = parseVersionTag(`v${current}`);
    if (!currentTuple) {
      return { status: 'error' };
    }

    if (compareVersions(latestTuple, currentTuple) > 0) {
      return { status: 'update-available', current, latest: latestTag.replace(/^v/, '') };
    }
    return { status: 'up-to-date', current };
  } catch {
    return { status: 'error' };
  }
}
