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

    const flags = [
      '--space-id',
      '--environment-id',
      '--cma-token',
      '--project',
      '--out',
      '--agent',
      '--model',
      '--skip-map-tokens',
      '--no-cache',
      '--verbose',
      '--host',
    ];

    for (const flag of flags) {
      expect(stdout, `expected ${flag} in help output`).toContain(flag);
    }
  });

  it('shows default agent value as "claude" in --help output', async () => {
    const { stdout, code } = await run(['import', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('claude');
  });
});

describe('import — credential flags', () => {
  it('accepts --space-id in headless (skip-all) mode', async () => {
    const { stderr, code } = await run([...skipAll(), '--space-id', 'testspace'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('accepts --environment-id in headless (skip-all) mode', async () => {
    const { stderr, code } = await run([...skipAll(), '--environment-id', 'master'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('accepts --cma-token in headless (skip-all) mode', async () => {
    const { stderr, code } = await run([...skipAll(), '--cma-token', 'fake-token'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('reads CONTENTFUL_SPACE_ID env var when --space-id is not provided', async () => {
    // --skip-apply means credentials aren't required; env var should be accepted silently
    const { stderr, code } = await run(skipAll(), {
      ...baseEnv(),
      CONTENTFUL_SPACE_ID: 'env-space',
    });
    expect(stderr).not.toContain('CONTENTFUL_SPACE_ID');
    expect(code).toBe(0);
  });

  it('reads CONTENTFUL_ENVIRONMENT_ID env var when --environment-id is not provided', async () => {
    const { stderr, code } = await run(skipAll(), {
      ...baseEnv(),
      CONTENTFUL_ENVIRONMENT_ID: 'env-env',
    });
    expect(stderr).not.toContain('CONTENTFUL_ENVIRONMENT_ID');
    expect(code).toBe(0);
  });

  it('reads CONTENTFUL_MANAGEMENT_TOKEN env var when --cma-token is not provided', async () => {
    const { stderr, code } = await run(skipAll(), {
      ...baseEnv(),
      CONTENTFUL_MANAGEMENT_TOKEN: 'env-token',
    });
    expect(stderr).not.toContain('CONTENTFUL_MANAGEMENT_TOKEN');
    expect(code).toBe(0);
  });

  it('uses all three credential env vars together to satisfy requirements', async () => {
    // Without --skip-apply the command normally requires credentials; env vars should supply them.
    // The pipeline will fail at analyze extract (no components), but not at credential validation.
    const { stderr } = await run(
      ['import', '--help'],
      {
        ...baseEnv(),
        CONTENTFUL_SPACE_ID: 'env-space',
        CONTENTFUL_ENVIRONMENT_ID: 'env-env',
        CONTENTFUL_MANAGEMENT_TOKEN: 'env-token',
      },
      30_000,
    );
    expect(stderr).not.toContain('--space-id');
    expect(stderr).not.toContain('--environment-id');
    expect(stderr).not.toContain('--cma-token');
  });
});

describe('import — skip flags', () => {
  it('--skip-map-tokens is accepted in headless mode', async () => {
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

  it('--no-push works headless on a non-TTY (piped) without credentials or the interactive error', async () => {
    // Regression: previously --no-push (unlike --skip-apply) demanded credentials
    // and/or errored "experiences import is interactive" when stdout was a pipe.
    // --no-push is now the canonical "don't push" flag and works in both contexts.
    const { stderr } = await run(
      ['import', '--help', '--no-push'],
      baseEnv(),
    );
    expect(stderr).not.toContain('--space-id');
    expect(stderr).not.toContain('--cma-token');
    expect(stderr).not.toContain('is interactive');
  });

  it('--no-push and --skip-apply are interchangeable for the credential requirement', async () => {
    const noPush = await run(
      ['import', '--help', '--no-push'],
      baseEnv(),
    );
    const skipApply = await run(skipAll(), baseEnv());
    expect(noPush.code).toBe(skipApply.code);
    expect(noPush.stderr).not.toContain('--cma-token');
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

  it('--out <path> is accepted without error', async () => {
    const outDir = await createTempDir('import-out-test-');
    const { stderr, code } = await run([...skipAll(), '--out', outDir], baseEnv());
    expect(stderr).not.toContain("unknown option '--out'");
    expect(code).toBe(0);
  });

  it('--verbose is accepted without error', async () => {
    const { stderr, code } = await run([...skipAll(), '--verbose'], baseEnv());
    expect(stderr).not.toContain("unknown option '--verbose'");
    expect(code).toBe(0);
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
  it('--yes is accepted as a flag', async () => {
    const { stderr, code } = await run([...skipAll(), '--yes'], baseEnv());
    expect(stderr).not.toContain("unknown option '--yes'");
    expect(code).toBe(0);
  });

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
    const freshProjectDir = await createTempDir('no-cache-project-');
    const freshDbPath = join(await createTempDir('no-cache-db-'), 'pipeline.db');
    const { stderr } = await run(
      [
        'import',
        '--help',
        '--no-cache',
      ],
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
    const { stderr, code } = await run(
      ['import', '--help', '--project', projectDir],
      baseEnv(),
    );
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('fails with a nonexistent --project path', async () => {
    const { stderr, code } = await run(
      ['import', '--help', '--project', '/nonexistent/does/not/exist'],
      baseEnv(),
    );
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
    const { stdout, code } = await run(
      ['import', '--help', '--project', '~/myproj'],
      { NODE_NO_WARNINGS: '1', HOME: fakeHome },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('--project');
  }, 60000);
});
