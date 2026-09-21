import { binaryExists } from '@contentful/experience-design-system-generation';
import { exitWithAnalytics } from '../analytics/index.js';

export function die(message: string): never {
  process.stderr.write(`${message}\n`);
  void exitWithAnalytics(1);
  throw new Error('exit');
}

export async function assertBinaryInPath(binary: string): Promise<boolean> {
  // Was `which <binary>`, which doesn't exist on Windows and so reported every
  // agent as missing there. binaryExists also matches `.cmd`/`.bat` shims, which
  // is how npm installs these CLIs on Windows.
  return binaryExists(binary);
}
