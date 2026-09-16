import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETUP_REQUIRES_TTY_MESSAGE } from '../../src/setup/command.js';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

function run(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise) => {
    execFile('node', [bin, ...args], (error, stdout, stderr) => {
      resolvePromise({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

describe('experiences setup mounting', () => {
  it('rejects a non-TTY session with an interactive-terminal error', async () => {
    // execFile gives us a non-TTY stdin/stdout by definition.
    const { code, stderr } = await run('setup');

    expect(code).toBe(1);
    expect(stderr).toContain(SETUP_REQUIRES_TTY_MESSAGE);
  });

  it('states the required message verbatim', () => {
    expect(SETUP_REQUIRES_TTY_MESSAGE).toBe('Error: experiences setup requires an interactive terminal.');
  });

  it('keeps the skip flags documented on the setup command', async () => {
    const { stdout, code } = await run('setup', '--help');

    expect(code).toBe(0);
    expect(stdout).toContain('--skip-build');
    expect(stdout).toContain('--skip-agent');
    expect(stdout).toContain('--skip-credentials');
    expect(stdout).toContain('--skip-optional');
  });

  it('leaves experiences doctor available with its own flags', async () => {
    const { stdout, code } = await run('doctor', '--help');

    expect(code).toBe(0);
    expect(stdout).toContain('--skip-build');
    expect(stdout).toContain('--skip-agent');
  });

  it('mounts the Ink screen rather than the readline flow', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(resolve(import.meta.dirname, '../../src/setup/command.ts'), 'utf8'),
    );

    expect(source).toContain("await import('ink')");
    expect(source).toContain("await import('./tui/SetupScreen.js')");
    expect(source).not.toContain('node:readline');
    expect(source).not.toContain('\\x1b[2J');
  });
});
