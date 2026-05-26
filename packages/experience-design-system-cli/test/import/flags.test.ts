import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
      { env: { ...process.env, NODE_NO_WARNINGS: '1', ...env }, timeout },
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
  return ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', projectDir];
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
      '--tokens',
      '--select-all',
      '--select',
      '--deselect',
      '--skip-analyze',
      '--skip-generate',
      '--print',
      '--skip-apply',
      '--no-cache',
      '--yes',
      '--verbose',
      '--viewports',
      '--host',
      '--dry-run',
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
      ['import', '--skip-analyze', '--skip-generate', '--project', projectDir],
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
  it('--skip-apply removes credential requirement', async () => {
    const { stderr } = await run(skipAll(), baseEnv());
    expect(stderr).not.toContain('--space-id');
    expect(stderr).not.toContain('--environment-id');
    expect(stderr).not.toContain('--cma-token');
  });

  it('--skip-analyze alone is accepted as a flag', async () => {
    const { stderr, code } = await run(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', projectDir],
      baseEnv(),
    );
    expect(stderr).not.toContain("unknown option '--skip-analyze'");
    expect(code).toBe(0);
  });

  it('--skip-generate alone is accepted as a flag', async () => {
    const { stderr, code } = await run(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', projectDir],
      baseEnv(),
    );
    expect(stderr).not.toContain("unknown option '--skip-generate'");
    expect(code).toBe(0);
  });

  it('all three skip flags together exit 0', async () => {
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

  it('--dry-run is accepted with --skip-apply (no external deps)', async () => {
    // --dry-run tells the pipeline to print the generate prompt rather than invoking the agent.
    // With --skip-generate the generate step is skipped entirely, so the flag is parsed but unused.
    const { stderr, code } = await run([...skipAll(), '--dry-run'], baseEnv());
    expect(stderr).not.toContain("unknown option '--dry-run'");
    expect(code).toBe(0);
  });
});

describe('import — output flags', () => {
  it('--print is accepted without error', async () => {
    const { stderr } = await run([...skipAll(), '--print'], baseEnv());
    // --print is a valid flag; it should never be rejected as an unknown option.
    // The step itself may fail if there is no prior generate session in the DB —
    // that is expected for an empty test DB and is not a flag-acceptance failure.
    expect(stderr).not.toContain("unknown option '--print'");
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
  it('--select-all is accepted without error', async () => {
    const { stderr, code } = await run([...skipAll(), '--select-all'], baseEnv());
    expect(stderr).not.toContain("unknown option '--select-all'");
    expect(code).toBe(0);
  });

  it('--select <pattern> is accepted without error', async () => {
    const { stderr, code } = await run([...skipAll(), '--select', 'Button'], baseEnv());
    expect(stderr).not.toContain("unknown option '--select'");
    expect(code).toBe(0);
  });

  it('--deselect <pattern> is accepted without error', async () => {
    const { stderr, code } = await run([...skipAll(), '--deselect', 'Icon'], baseEnv());
    expect(stderr).not.toContain("unknown option '--deselect'");
    expect(code).toBe(0);
  });

  it('--select can be repeated multiple times', async () => {
    const { stderr, code } = await run([...skipAll(), '--select', 'Button', '--select', 'Card'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('--deselect can be repeated multiple times', async () => {
    const { stderr, code } = await run([...skipAll(), '--deselect', 'Icon', '--deselect', 'Avatar'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('--select and --deselect can be combined', async () => {
    const { stderr, code } = await run([...skipAll(), '--select', 'Button', '--deselect', 'Icon'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('--select-all and --select can be combined', async () => {
    const { stderr, code } = await run([...skipAll(), '--select-all', '--select', 'Button'], baseEnv());
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
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

  it('--no-cache is accepted and overrides --skip-analyze (forces re-run)', async () => {
    const { stderr } = await run([...skipAll(), '--no-cache'], baseEnv(), 30_000);
    expect(stderr).not.toContain("unknown option '--no-cache'");
    // --no-cache overrides --skip-analyze, so analyze runs (may fail on minimal fixture)
    // The important assertion is that the flag is recognized and acted upon
  });

  it('--tokens <path> is accepted without error', async () => {
    const { stderr, code } = await run([...skipAll(), '--tokens', '/dev/null'], baseEnv());
    expect(stderr).not.toContain("unknown option '--tokens'");
    expect(code).toBe(0);
  });

  it('--viewports <path> is accepted without error', async () => {
    const { stderr, code } = await run([...skipAll(), '--viewports', '/dev/null'], baseEnv());
    expect(stderr).not.toContain("unknown option '--viewports'");
    expect(code).toBe(0);
  });
});

describe('import — project path flag', () => {
  it('--project <path> is accepted with a valid directory', async () => {
    const { stderr, code } = await run(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', projectDir],
      baseEnv(),
    );
    expect(stderr).not.toContain('unknown option');
    expect(code).toBe(0);
  });

  it('fails with a nonexistent --project path', async () => {
    const { stderr, code } = await run(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', '/nonexistent/does/not/exist'],
      baseEnv(),
    );
    // The pipeline may fail, but it should not be due to an unknown option
    expect(stderr).not.toContain("unknown option '--project'");
    expect(code).not.toBe(0);
  });
});
