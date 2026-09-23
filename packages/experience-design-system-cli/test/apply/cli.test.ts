import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerApplyCommand } from '../../src/apply/command.js';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');
const fixturesDir = resolve(import.meta.dirname, '../fixtures/import');
const componentsPath = join(fixturesDir, 'components.json');

function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((res) => {
    execFile('node', [bin, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

describe('apply command — help', () => {
  it('keeps each subcommand flag inventory stable when options are registered through helpers', () => {
    const program = new Command();
    registerApplyCommand(program);
    const apply = program.commands.find((command) => command.name() === 'apply');
    expect(apply).toBeDefined();

    const flags = (name: string) =>
      apply!.commands
        .find((command) => command.name() === name)!
        .options.map((option) => option.long)
        .sort();

    expect(flags('push')).toEqual([
      '--atomic',
      '--cma-token',
      '--components',
      '--composite',
      '--dry-run',
      '--environment-id',
      '--force',
      '--host',
      '--session',
      '--space-id',
      '--tokens',
      '--verbose',
      '--yes',
    ]);
  });

  it('prints apply help', async () => {
    const { stdout, code } = await run(['apply', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('push');
    expect(stdout).not.toContain('select');
  });

  it('prints apply push help', async () => {
    const { stdout, code } = await run(['apply', 'push', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--yes');
  });
});

describe('apply push — input validation', () => {
  it('exits 1 in non-TTY mode without --yes', async () => {
    const { stderr, code } = await run([
      'apply',
      'push',
      '--components',
      componentsPath,
      '--space-id',
      'space1',
      '--environment-id',
      'master',
      '--cma-token',
      'tok',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--yes');
  });

  it('exits 1 when --tokens path does not exist', async () => {
    const { stderr, code } = await run([
      'apply',
      'push',
      '--tokens',
      '/no/such/tokens.json',
      '--space-id',
      'space1',
      '--environment-id',
      'master',
      '--cma-token',
      'tok',
      '--yes',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('file not found');
  });
});

describe('apply push — new flags', () => {
  it('prints --force in help output', async () => {
    const { stdout, code } = await run(['apply', 'push', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--force');
  });

  it('prints --dry-run in help output', async () => {
    const { stdout, code } = await run(['apply', 'push', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--dry-run');
  });

  it('--force description mentions breaking changes', async () => {
    const { stdout, code } = await run(['apply', 'push', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('breaking changes');
  });

  it('--dry-run description mentions preview only', async () => {
    const { stdout, code } = await run(['apply', 'push', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('preview only');
  });
});
