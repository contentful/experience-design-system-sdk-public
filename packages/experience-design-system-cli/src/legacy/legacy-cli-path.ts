import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findPackageRoot } from '../tui/package-root.js';

const PACKAGE_NAME = '@contentful/experience-design-system-cli';

export function findLegacyCliPath(): string {
  const root = findPackageRoot(import.meta.url, PACKAGE_NAME);
  const candidates = [
    join(root, 'legacy', 'bin', 'cli.js'),
    join(root, '..', 'experience-design-system-cli-legacy', 'bin', 'cli.js'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Legacy CLI not found. Looked in:\n${candidates.join('\n')}`);
  }
  return found;
}
