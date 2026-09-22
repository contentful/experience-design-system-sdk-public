import { binaryExists } from '@contentful/experience-design-system-generation';
import { exitWithAnalytics } from '../analytics/index.js';

export function die(message: string): never {
  process.stderr.write(`${message}\n`);
  void exitWithAnalytics(1);
  throw new Error('exit');
}

export async function assertBinaryInPath(binary: string): Promise<boolean> {
  // Replaces `which <binary>`, which doesn't exist on Windows. Also matches the
  // `.cmd` shims npm creates there.
  return binaryExists(binary);
}
