import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

// Strip Contentful env vars so credential-validation tests are not bypassed
// by values set in the developer's shell environment.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !['CONTENTFUL_SPACE_ID', 'CONTENTFUL_ENVIRONMENT_ID', 'CONTENTFUL_MANAGEMENT_TOKEN'].includes(k),
  ),
);

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((res) => {
    execFile('node', [bin, ...args], { env: cleanEnv }, (error, stdout, stderr) => {
      res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

describe('import command — help', () => {
  it('shows import as a top-level command', async () => {
    const { stdout, code } = await run(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('import');
  });

  it('prints import help with --help', async () => {
    const { stdout, code } = await run(['import', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--space-id');
    expect(stdout).toContain('--environment-id');
    expect(stdout).toContain('--cma-token');
    expect(stdout).toContain('--project');
    expect(stdout).toContain('--out');
    expect(stdout).toContain('--agent');
    expect(stdout).toContain('--tokens');
    expect(stdout).toContain('--skip-analyze');
    expect(stdout).toContain('--skip-generate');
    expect(stdout).toContain('--print');
    expect(stdout).toContain('--skip-apply');
    expect(stdout).toContain('--yes');
    expect(stdout).toContain('--verbose');
  });

  it('does not expose --skip-print (replaced by --print)', async () => {
    const { stdout, code } = await run(['import', '--help']);
    expect(code).toBe(0);
    expect(stdout).not.toContain('--skip-print');
  });

  it('fails when --space-id is missing', async () => {
    const { stderr, code } = await run(['import', '--environment-id', 'master', '--cma-token', 'token']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('space-id');
  });

  it('fails when --environment-id is missing', async () => {
    const { stderr, code } = await run(['import', '--space-id', 'abc123', '--cma-token', 'token']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('environment-id');
  });

  it('fails when --cma-token is missing and env var is not set', async () => {
    const { code } = await run(['import', '--space-id', 'abc123', '--environment-id', 'master']);
    expect(code).not.toBe(0);
  });

  it('accepts --skip-apply without credentials', async () => {
    // With --skip-apply, the credential check is skipped; the pipeline will fail at analyze
    // (no project), but the credential check itself should not fire.
    const { stderr } = await run([
      'import',
      '--skip-apply',
      '--skip-generate',
      '--skip-analyze',
      '--project',
      '/nonexistent',
    ]);
    expect(stderr).not.toContain('--space-id');
    expect(stderr).not.toContain('--environment-id');
    expect(stderr).not.toContain('--cma-token');
  });
});
