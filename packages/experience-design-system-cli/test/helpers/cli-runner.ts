import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');
const nodeExe = process.execPath; // Use the same Node executable as the test runner

export type CliResult = { stdout: string; stderr: string; code: number };

export function runCli(args: string[], timeout = 15000): Promise<CliResult> {
  return new Promise((res) => {
    execFile(
      nodeExe,
      [bin, ...args],
      { env: { ...process.env, DISABLE_ANALYTICS: '1' }, timeout },
      (error, stdout, stderr) => {
        const code = error?.code ?? 0;
        res({ stdout, stderr, code: typeof code === 'string' ? parseInt(code, 10) : code });
      },
    );
  });
}

export function runCliWithEnv(args: string[], env: Record<string, string>, timeout = 15000): Promise<CliResult> {
  return new Promise((res) => {
    execFile(
      nodeExe,
      [bin, ...args],
      { env: { ...process.env, DISABLE_ANALYTICS: '1', ...env }, timeout },
      (error, stdout, stderr) => {
        const code = error?.code ?? 0;
        res({ stdout, stderr, code: typeof code === 'string' ? parseInt(code, 10) : code });
      },
    );
  });
}
