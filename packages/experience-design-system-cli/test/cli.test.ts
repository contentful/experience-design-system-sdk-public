import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bin = resolve(import.meta.dirname, '../bin/cli.js');

function run(...args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveResult) => {
    execFile('node', [bin, ...args], (error, stdout, stderr) => {
      resolveResult({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

describe('CLI entry point', () => {
  it('prints help with --help without removed base commands', async () => {
    const { stdout, code } = await run('--help');
    expect(code).toBe(0);
    expect(stdout).toContain('experience-design-system-cli');
    expect(stdout).not.toMatch(/^  analyze\b/m);
    expect(stdout).not.toMatch(/^  print\b/m);
    expect(stdout).not.toMatch(/^  map\b/m);
    expect(stdout).not.toMatch(/^  session\b/m);
    expect(stdout).not.toMatch(/^  runs\b/m);
  });

  it('lists visible commands in the supported order', async () => {
    const { stdout, code } = await run('--help');
    expect(code).toBe(0);
    const commands = ['build', 'help', 'import', 'apply', 'importv2', 'setup', 'doctor'];
    const positions = commands.map((command) => stdout.indexOf(`  ${command}`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('exits with error for unknown commands', async () => {
    const { stderr, code } = await run('nonexistent');
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown command 'nonexistent'");
  });

  it('does not expose the internal analyze command tree', async () => {
    const { stderr, code } = await run('analyze');
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown command 'analyze'");
  });
});

describe('experiences import flag surface', () => {
  it('does not expose --auto-accept-scope in --help', async () => {
    const { stdout, code } = await run('import', '--help');
    expect(code).toBe(0);
    expect(stdout).not.toContain('--auto-accept-scope');
  });

  it('exposes --no-cache in experiences import --help', async () => {
    const { stdout, code } = await run('import', '--help');
    expect(code).toBe(0);
    expect(stdout).toContain('--no-cache');
  });

  it('does not expose --no-auto-filter in experiences import --help', async () => {
    const { stdout, code } = await run('import', '--help');
    expect(code).toBe(0);
    expect(stdout).not.toContain('--no-auto-filter');
  });

  it('does not expose --auto-filter in experiences import --help', async () => {
    const { stdout, code } = await run('import', '--help');
    expect(code).toBe(0);
    expect(stdout).not.toContain('--auto-filter');
  });

  it('does not expose --no-live-preview in --help', async () => {
    const { stdout, code } = await run('import', '--help');
    expect(code).toBe(0);
    expect(stdout).not.toContain('--no-live-preview');
  });

  it('rejects removed debug flags', async () => {
    const debug = await run('import', '--debug', '--project', '/tmp');
    const noDebug = await run('import', '--no-debug', '--project', '/tmp');
    expect(debug.code).not.toBe(0);
    expect(debug.stderr).toContain("unknown option '--debug'");
    expect(noDebug.code).not.toBe(0);
    expect(noDebug.stderr).toContain("unknown option '--no-debug'");
  });

  it('fails loud when import runs without a TTY', async () => {
    const { code, stderr } = await run('import', '--project', '/tmp');
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/TTY/i);
  });
});

describe('experiences setup', () => {
  it('rejects command flags', async () => {
    const { stderr, code } = await run('setup', '--help');
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--help'");
  });

  it('rejects a non-TTY session', async () => {
    const { stderr, code } = await run('setup');
    expect(code).toBe(1);
    expect(stderr).toContain('Error: experiences setup requires an interactive terminal.');
  });

  it('does not prompt for credentials on a non-TTY session', async () => {
    const { stdout } = await run('setup');
    expect(stdout).not.toContain('CMA token');
    expect(stdout).not.toContain('Space ID');
  });
});

describe('experiences doctor', () => {
  it('rejects all command flags', async () => {
    const { stdout, stderr, code } = await run('doctor', '--help');
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--help'");
    expect(stdout).not.toContain('--skip-build');
    expect(stdout).not.toContain('--skip-agent');
  });
});
