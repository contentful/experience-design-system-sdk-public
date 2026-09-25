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

  it('fails loud when import runs without a TTY', async () => {
    const { code, stderr } = await run('import', '--project', '/tmp');
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/TTY/i);
  });
});
