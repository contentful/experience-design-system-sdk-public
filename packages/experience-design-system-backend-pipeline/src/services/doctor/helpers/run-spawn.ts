import { spawn } from 'node:child_process';
import type { ShellCommandResult } from '../types/shell.js';

export function runSpawn(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ShellCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    const settle = (result: ShellCommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on('error', (err) => settle({ exitCode: 1, stdout: '', stderr: err.message }));
    child.stdout.on('data', (d: Buffer) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += String(d);
    });
    child.on('exit', (code) => settle({ exitCode: code ?? 1, stdout, stderr }));
  });
}
