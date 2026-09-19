import { access } from 'node:fs/promises';

export function pathExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}
