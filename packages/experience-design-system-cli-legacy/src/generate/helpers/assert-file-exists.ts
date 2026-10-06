import { pathExists } from '../../lib/path-exists.js';
import { die } from '../../lib/cli-errors.js';

export async function assertFileExists(flag: string, p: string): Promise<void> {
  if (!(await pathExists(p))) die(`Error: file not found: ${p} (from ${flag})`);
}
