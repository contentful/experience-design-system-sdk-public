import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

const tempDirs: string[] = [];
async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

let projectDir: string;
let dbPath: string;

beforeAll(async () => {
  const base = await createTempDir('import-print-prompt-');
  projectDir = base;
  dbPath = join(base, 'pipeline.db');
});

function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  timeout = 20_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((res) => {
    execFile(
      'node',
      [bin, ...args],
      {
        env: { ...process.env, NODE_NO_WARNINGS: '1', EDS_PIPELINE_DB_PATH: dbPath, ...env },
        timeout,
      },
      (error, stdout, stderr) => {
        res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
      },
    );
  });
}

// Use --skip-analyze + --skip-generate + --skip-apply to make the flag-parse
// fast-path; --print-prompt / --dry-run only matter for flag parsing here.
function args(extra: string[]): string[] {
  return ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', projectDir, ...extra];
}

describe('experiences import — --print-prompt', () => {
  it('lists --print-prompt in --help', async () => {
    const { stdout, code } = await run(['import', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--print-prompt');
  });

  it('marks --dry-run as deprecated in --help text', async () => {
    const { stdout, code } = await run(['import', '--help']);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/deprecat/);
  });

  it('--print-prompt is accepted and does NOT emit the deprecation notice', async () => {
    const { stderr, code } = await run(args(['--print-prompt']));
    expect(stderr).not.toContain("unknown option '--print-prompt'");
    expect(stderr).not.toMatch(/will change semantics/);
    expect(code).toBe(0);
  });

  it('bare --dry-run emits the deprecation notice to stderr', async () => {
    const { stderr, code } = await run(args(['--dry-run']));
    expect(stderr).toContain('--dry-run');
    expect(stderr).toMatch(/will change semantics/);
    expect(stderr).toContain('--print-prompt');
    expect(code).toBe(0);
  });

  it('--print-prompt does NOT emit the deprecation notice', async () => {
    const { stderr } = await run(args(['--print-prompt']));
    expect(stderr).not.toMatch(/will change semantics/);
  });

  it.todo('--dry-run --no-push delegates to manifest-preview semantics (follow-up PR)');
});
