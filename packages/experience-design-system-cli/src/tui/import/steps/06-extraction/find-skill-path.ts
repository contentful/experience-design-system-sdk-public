import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findSkillPath(fileName: string): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (;;) {
    const candidate = join(dir, 'skills', fileName);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(`skill file not found (looked for skills/${fileName} from ${thisDir})`);
    }
    dir = parent;
  }
}
