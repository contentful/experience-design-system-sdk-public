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
  it('keeps the apply flag inventory stable when options are registered through helpers', () => {
    const program = new Command();
    registerApplyCommand(program);
    const apply = program.commands.find((command) => command.name() === 'apply');
    expect(apply).toBeDefined();

    const flags = apply!.options.map((option) => option.long).sort();

    expect(flags).toEqual([
      '--components',
      '--tokens',
    ]);
  });

});

describe('apply — input validation', () => {
  it('exits 1 in non-interactive mode', async () => {
    const { stderr, code } = await run([
      'apply',
      '--components',
      componentsPath,
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('interactive terminal');
  });

});
