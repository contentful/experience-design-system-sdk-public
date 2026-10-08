import { join } from 'node:path';
import { binaryExists } from '../helpers/binary-exists.js';
import { pathExists } from '../helpers/path-exists.js';

export interface NodeVersionManagers {
  nvm: boolean;
  fnm: boolean;
  nvmScript: string;
}

export async function detectNodeVersionManagers(
  homeDir: string,
  deps: { binaryExists: typeof binaryExists; pathExists: typeof pathExists } = {
    binaryExists,
    pathExists,
  },
): Promise<NodeVersionManagers> {
  const nvmScript = join(homeDir, '.nvm', 'nvm.sh');
  return {
    nvm: (await deps.binaryExists('nvm')) || (await deps.pathExists(nvmScript)),
    fnm: await deps.binaryExists('fnm'),
    nvmScript,
  };
}
