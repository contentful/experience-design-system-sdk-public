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

// Help output exercises parsing without running the pipeline.
function args(extra: string[]): string[] {
  return ['import', '--help', ...extra];
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


  it.todo('--dry-run --no-push delegates to manifest-preview semantics (follow-up PR)');
});
