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

  it('rejects command flags', async () => {
    const { stderr, code } = await run('setup', '--help');

    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--help'");
  });

  it('leaves experiences doctor available without command flags', async () => {
    const { stderr, code } = await run('doctor', '--help');

    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--help'");
  });

  // Previously asserted on command.ts's source text, which only survived a
  // refactor by being edited. The readline flow's defining trait was that it
  // prompted on a non-TTY instead of refusing, so assert that instead.
  it('never prompts on a non-TTY, even with credentials unset', async () => {
    const { stdout, stderr, code } = await run('setup');

    expect(code).toBe(1);
    expect(stderr).toContain(SETUP_REQUIRES_TTY_MESSAGE);
    expect(stdout).toBe('');
  });
});
