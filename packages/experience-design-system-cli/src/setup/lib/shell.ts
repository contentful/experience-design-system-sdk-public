import { execFile, spawn } from 'node:child_process';
import { appendFile, readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const REQUIRED_NODE_MAJOR = 24;

export interface ShellCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function binaryExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('which', [name]);
    return true;
  } catch {
    return false;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

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

export async function detectShellProfile(): Promise<string> {
  const shell = process.env['SHELL'] ?? '';
  const home = homedir();

  if (shell.includes('zsh')) return join(home, '.zshrc');
  if (shell.includes('bash')) {
    // Prefer .bash_profile on macOS (login shell), .bashrc on Linux.
    const bashProfile = join(home, '.bash_profile');
    return (await pathExists(bashProfile)) ? bashProfile : join(home, '.bashrc');
  }
  if (shell.includes('fish')) return join(home, '.config', 'fish', 'config.fish');
  return join(home, '.profile');
}

export async function profileContains(profilePath: string, value: string): Promise<boolean> {
  try {
    const content = await readFile(profilePath, 'utf8');
    return content.includes(value);
  } catch {
    return false;
  }
}

export async function appendToProfile(profilePath: string, lines: string): Promise<void> {
  await appendFile(profilePath, `\n${lines}\n`, 'utf8');
}
