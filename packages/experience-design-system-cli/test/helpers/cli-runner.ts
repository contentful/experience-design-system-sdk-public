import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

export type CliResult = { stdout: string; stderr: string; code: number };

export function runCli(args: string[], timeout = 15000): Promise<CliResult> {
  return new Promise((res) => {
    execFile('node', [bin, ...args], { timeout }, (error, stdout, stderr) => {
      res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

export function runCliWithEnv(args: string[], env: Record<string, string>, timeout = 15000): Promise<CliResult> {
  return new Promise((res) => {
    execFile('node', [bin, ...args], { env: { ...process.env, ...env }, timeout }, (error, stdout, stderr) => {
      res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}
