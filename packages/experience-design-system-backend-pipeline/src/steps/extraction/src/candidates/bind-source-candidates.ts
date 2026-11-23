import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

function canonicalPath(path: string): string {
  let existing = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    suffix.unshift(basename(existing));
    existing = parent;
  }
  try {
    return resolve(realpathSync.native(existing), ...suffix);
  } catch {
    return resolve(path);
  }
}
export { canonicalPath as canonicalSourceFactPath };
