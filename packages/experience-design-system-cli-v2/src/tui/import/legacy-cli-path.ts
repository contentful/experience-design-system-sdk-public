import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Path to the legacy CLI's `bin/cli.js`. Walks up from this module looking for a
 * `packages/` directory containing an `experience-design-system-cli` sibling, so it
 * survives src/dist layout changes on either package without a hardcoded depth.
 */
export function findLegacyCliPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '..', 'experience-design-system-cli', 'bin', 'cli.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback path; callers' existsSync checks surface a clear error if wrong.
  return join(
    fileURLToPath(import.meta.url),
    '..',
    '..',
    '..',
    '..',
    '..',
    'experience-design-system-cli',
    'bin',
    'cli.js',
  );
}
