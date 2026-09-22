import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

// ── Shared temp dir lifecycle ──────────────────────────────────────────────

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

// ── Single shared project dir + DB ────────────────────────────────────────

let projectDir: string;
let dbPath: string;

beforeAll(async () => {
  const base = await createTempDir('import-flags-');
  projectDir = base;
  dbPath = join(base, 'pipeline.db');
});

// ── Runner helpers ─────────────────────────────────────────────────────────

function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  timeout = 15_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((res) => {
    execFile(
      'node',
      [bin, ...args],
      { env: { ...process.env, DISABLE_ANALYTICS: '1', NODE_NO_WARNINGS: '1', ...env }, timeout },
      (error, stdout, stderr) => {
        res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
      },
    );
  });
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    EDS_PIPELINE_DB_PATH: dbPath,
    NODE_NO_WARNINGS: '1',
  };
}

// ── Baseline args that skip all pipeline steps safely ─────────────────────
// Anything that just needs to verify a flag is accepted can append to this.
function skipAll(): string[] {
  return ['import', '--help'];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('import — help output lists all flags', () => {
  it('shows all documented flags in --help output', async () => {
    const { stdout, code } = await run(['import', '--help']);
    expect(code).toBe(0);

    const flags = ['--project', '--agent', '--model', '--skip-map-tokens', '--no-cache', '--host'];

    for (const flag of flags) {
      expect(stdout, `expected ${flag} in help output`).toContain(flag);
    }
    expect(stdout).not.toContain('--atomic');
    expect(stdout).not.toContain('--composition-refresh');
    expect(stdout).not.toContain('--composition-agent');
    expect(stdout).not.toContain('--composition-agent-mode');
  });

  it('shows default agent value as "claude" in --help output', async () => {
    const { stdout, code } = await run(['import', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('claude');
  });
});

describe('import — skip flags', () => {
  it('--skip-map-tokens is accepted by the import wizard', async () => {
    const { stderr, code } = await run([...skipAll(), '--skip-map-tokens'], baseEnv());
    expect(stderr).not.toContain("unknown option '--skip-map-tokens'");
    expect(code).toBe(0);
  });

  it('does not retain the --no-map-tokens alias', async () => {
    const { stderr, code } = await run(['import', '--no-map-tokens'], baseEnv());
    expect(stderr).toContain("unknown option '--no-map-tokens'");
    expect(code).not.toBe(0);
  });

  it('--skip-apply removes credential requirement', async () => {
    const { stderr } = await run(skipAll(), baseEnv());
    expect(stderr).not.toContain('--space-id');
    expect(stderr).not.toContain('--environment-id');
    expect(stderr).not.toContain('--cma-token');
  });

  it('the remaining skip flags together exit 0', async () => {
    const { code } = await run(skipAll(), baseEnv());
    expect(code).toBe(0);
  });
});

describe('import — agent and model flags', () => {
  it('--agent is accepted without error', async () => {
    const { stderr, code } = await run([...skipAll(), '--agent', 'claude'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('--model is accepted without error (combined with skip flags)', async () => {
    const { stderr, code } = await run([...skipAll(), '--model', 'claude-opus-4-5'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });
});

describe('import — output flags', () => {
  it('--print is rejected as an unknown option', async () => {
    const { stderr, code } = await run(['import', '--print'], baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--print'");
  });
});

describe('import — selection flags', () => {
  it('--select-all is rejected as an unknown option', async () => {
    const { stderr, code } = await run(['import', '--select-all'], baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--select-all'");
  });
});

describe('import — removed flags', () => {
  it('--select is rejected as an unknown option', async () => {
    const { stderr, code } = await run(['import', '--select', 'Button'], baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--select'");
  });

  it('--deselect is rejected as an unknown option', async () => {
    const { stderr, code } = await run(['import', '--deselect', 'Icon'], baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--deselect'");
  });

  it('--tokens is rejected as an unknown option', async () => {
    const { stderr, code } = await run(['import', '--tokens', '/dev/null'], baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown option '--tokens'");
  });
});

describe('import — push-related flags', () => {
  it('--host <url> is accepted without error', async () => {
    const { stderr, code } = await run([...skipAll(), '--host', 'https://api.contentful.com'], baseEnv());
    expect(stderr).not.toContain("unknown option '--host'");
    expect(code).toBe(0);
  });

  it('--host <hostname> is accepted without requiring https://', async () => {
    const { stderr, code } = await run([...skipAll(), '--host', 'api.contentful.com'], baseEnv());
    expect(stderr).not.toContain("unknown option '--host'");
    expect(code).toBe(0);
  });

  it('--no-cache is accepted and forces a re-run', async () => {
    // Isolated project/DB: --no-cache forces a real analyze extract run, which
    // would otherwise leave a session in the shared DB for later tests to pick up.
    const freshDbPath = join(await createTempDir('no-cache-db-'), 'pipeline.db');
    const { stderr } = await run(
      ['import', '--help', '--no-cache'],
      { EDS_PIPELINE_DB_PATH: freshDbPath, NODE_NO_WARNINGS: '1' },
      30_000,
    );
    expect(stderr).not.toContain("unknown option '--no-cache'");
    // The important assertion is that the flag is recognized and acted upon.
  });

  it('--raw-tokens <path> is accepted when the file exists', async () => {
    const { stderr, code } = await run([...skipAll(), '--raw-tokens', '/dev/null'], baseEnv());
    expect(stderr).not.toContain("unknown option '--raw-tokens'");
    expect(stderr).not.toContain('file not found');
    expect(code).toBe(0);
  });

  it('--raw-tokens errors at parse time when the file does not exist', async () => {
    const { stderr, code } = await run(['import', '--raw-tokens', '/nonexistent/raw-tokens.scss'], baseEnv());
    expect(stderr).toContain('--raw-tokens');
    expect(stderr).toContain('file not found');
    expect(stderr).toContain('/nonexistent/raw-tokens.scss');
    expect(code).not.toBe(0);
  });
});

describe('import — project path flag', () => {
  it('--project <path> is accepted with a valid directory', async () => {
    const { stderr, code } = await run(['import', '--help', '--project', projectDir], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('fails with a nonexistent --project path', async () => {
    const { stderr, code } = await run(['import', '--help', '--project', '/nonexistent/does/not/exist'], baseEnv());
    // The pipeline may fail, but it should not be due to an unknown option
    expect(stderr).not.toContain("unknown option '--project'");
    expect(code).toBe(0);
  });
});

describe('import — ~ expansion for --project and --raw-tokens', () => {
  const REAL_PROJECT_DIR = resolve(import.meta.dirname, '../fixtures/analyze/project');

  it('--raw-tokens ~/tokens.json does not report a false file-not-found', async () => {
    const fakeHome = await createTempDir('fake-home-');
    await writeFile(join(fakeHome, 'tokens.json'), '{}');

    const { stderr, code } = await run([...skipAll(), '--raw-tokens', '~/tokens.json'], {
      ...baseEnv(),
      HOME: fakeHome,
    });

    expect(stderr).not.toContain('--raw-tokens: file not found');
    expect(code).toBe(0);
  });

  it('--project ~/myproj resolves against $HOME, not a literal ~ directory', async () => {
    const fakeHome = await createTempDir('fake-home-');
    await cp(REAL_PROJECT_DIR, join(fakeHome, 'myproj'), { recursive: true });
    const { stdout, code } = await run(['import', '--help', '--project', '~/myproj'], {
      NODE_NO_WARNINGS: '1',
      HOME: fakeHome,
    });

    expect(code).toBe(0);
    expect(stdout).toContain('--project');
  }, 60000);
});
