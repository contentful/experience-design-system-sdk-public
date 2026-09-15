import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exitWithAnalytics } from '../analytics/index.js';

const execFileAsync = promisify(execFile);

export function die(message: string): never {
  process.stderr.write(`${message}\n`);
  void exitWithAnalytics(1);
  throw new Error('exit');
}

export async function assertBinaryInPath(binary: string): Promise<boolean> {
  try {
    await execFileAsync('which', [binary]);
    return true;
  } catch {
    return false;
  }
}
