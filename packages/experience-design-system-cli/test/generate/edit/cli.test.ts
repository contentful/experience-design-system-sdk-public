import { Command } from 'commander';
import { registerGenerateEditCommand } from '../../../src/generate/edit/command.js';
import { describe, expect, it } from 'vitest';

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  let stdout = '';
  let stderr = '';
  const generate = new Command('generate');
  generate.exitOverride();
  const components = generate.command('components').description('test');
  const tokens = generate.command('tokens').description('test');
  registerGenerateEditCommand(components, 'components');
  registerGenerateEditCommand(tokens, 'tokens');
  const program = new Command().name('experience-design-system-cli');
  program.addCommand(generate);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  program.configureOutput({
    writeOut: (value) => {
      stdout += value;
    },
    writeErr: (value) => {
      stderr += value;
    },
  });
  program.exitOverride();

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    await program.parseAsync(['node', 'experience-design-system-cli', ...args], { from: 'node' });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const exitCode =
      typeof error === 'object' && error && 'code' in error && String(error.code).startsWith('commander.help')
        ? 0
        : typeof error === 'object' && error && 'exitCode' in error
          ? Number(error.exitCode)
          : 1;
    return { stdout, stderr, code: exitCode };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

describe('generate components edit command', () => {
  it('prints help with --help', async () => {
    const { stdout, code } = await run(['generate', 'components', 'edit', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--accept-all');
    expect(stdout).toContain('--reject');
    expect(stdout).toContain('--patch');
  });
});

describe('generate tokens edit command', () => {
  it('prints help with --help', async () => {
    const { stdout, code } = await run(['generate', 'tokens', 'edit', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--accept-all');
    expect(stdout).toContain('--reject');
    expect(stdout).toContain('--patch');
  });
});
