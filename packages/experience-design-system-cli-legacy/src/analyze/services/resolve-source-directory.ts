import { resolve, isAbsolute } from 'node:path';
import { pathExists } from '../../lib/path-exists.js';

export async function resolveSourceDirectory(projectRoot: string, dir: string | undefined): Promise<string> {
  if (dir !== undefined) {
    const sourceDirectory = isAbsolute(dir) ? dir : resolve(projectRoot, dir);
    if (!(await pathExists(sourceDirectory))) {
      process.stderr.write(`Error: source directory does not exist: ${sourceDirectory}\n`);
      process.exit(1);
    }
    return sourceDirectory;
  }
  const srcPath = resolve(projectRoot, 'src');
  return (await pathExists(srcPath)) ? srcPath : projectRoot;
}
