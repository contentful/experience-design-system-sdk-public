import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');
const fixturesDir = resolve(import.meta.dirname, '../fixtures/import');
const componentsPath = join(fixturesDir, 'components.json');

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

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
  it('prints apply help', async () => {
    const { stdout, code } = await run(['apply', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('preview');
    expect(stdout).toContain('push');
    expect(stdout).toContain('select');
  });

  it('prints apply preview help', async () => {
    const { stdout, code } = await run(['apply', 'preview', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--components');
    expect(stdout).toContain('--tokens');
    expect(stdout).toContain('--space-id');
    expect(stdout).toContain('--environment-id');
    expect(stdout).toContain('--cma-token');
  });

  it('prints apply push help', async () => {
    const { stdout, code } = await run(['apply', 'push', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--yes');
  });

  it('prints apply select help with non-interactive flags', async () => {
    const { stdout, code } = await run(['apply', 'select', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--select-all');
    expect(stdout).toContain('--select');
    expect(stdout).toContain('--deselect');
  });
});

describe('apply preview — input validation', () => {
  it('exits 1 when neither --components nor --tokens provided', async () => {
    const { stderr, code } = await run([
      'apply',
      'preview',
      '--space-id',
      'space1',
      '--environment-id',
      'master',
      '--cma-token',
      'tok',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('at least one of --components');
  });

  it('exits 1 when --session and --components are both provided', async () => {
    const { stderr, code } = await run([
      'apply',
      'preview',
      '--session',
      'some-session-id',
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
    expect(stderr).toContain('mutually exclusive');
  });

  it('exits 1 when --space-id missing', async () => {
    const { stderr, code } = await run([
      'apply',
      'preview',
      '--components',
      componentsPath,
      '--environment-id',
      'master',
      '--cma-token',
      'tok',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--space-id');
  });

  it('exits 1 when --environment-id missing', async () => {
    const { stderr, code } = await run([
      'apply',
      'preview',
      '--components',
      componentsPath,
      '--space-id',
      'space1',
      '--cma-token',
      'tok',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--environment-id');
  });

  it('exits 1 when CMA token missing', async () => {
    const { stderr, code } = await run(
      ['apply', 'preview', '--components', componentsPath, '--space-id', 'space1', '--environment-id', 'master'],
      { CONTENTFUL_MANAGEMENT_TOKEN: '' },
    );
    expect(code).toBe(1);
    expect(stderr).toContain('CMA token is required');
  });

  it('exits 1 when --components path does not exist', async () => {
    const { stderr, code } = await run([
      'apply',
      'preview',
      '--components',
      '/no/such/file.json',
      '--space-id',
      'space1',
      '--environment-id',
      'master',
      '--cma-token',
      'tok',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('file not found');
  });

  it('exits 1 when --components is not valid JSON', async () => {
    const dir = await createTempDir('apply-bad-json-');
    const badJson = join(dir, 'bad.json');
    await writeFile(badJson, '{bad');
    const { stderr, code } = await run([
      'apply',
      'preview',
      '--components',
      badJson,
      '--space-id',
      'space1',
      '--environment-id',
      'master',
      '--cma-token',
      'tok',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('not valid JSON');
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
