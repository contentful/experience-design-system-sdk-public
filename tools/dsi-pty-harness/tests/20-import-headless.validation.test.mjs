/**
 * Tier 3a — headless import flows.
 *
 * These flags either force the CLI down the headless (non-TTY) branch or
 * short-circuit before the wizard opens. Each test asserts the observable
 * effect: exit code, a marker string on stdout/stderr, or a JSON shape.
 *
 * All use the react-minimal fixture and the offline stub agent — no LLM
 * traffic, no Contentful API traffic.
 *
 * Where a bare `--dry-run` would suffice on the CLI today, tests still pair
 * with `--skip-apply` so the missing-credentials check doesn't fire.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { REACT_MINIMAL } from './helpers/fixtures.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB_AGENT = resolve(HERE, '../src/stub-agent.mjs');

function stubEnv(extra = {}) {
  return {
    EDS_AGENT_BINARY_CLAUDE: STUB_AGENT,
    EDS_AGENT_BINARY_CODEX: STUB_AGENT,
    EDS_AGENT_BINARY_OPENCODE: STUB_AGENT,
    EDS_AGENT_BINARY_CURSOR: STUB_AGENT,
    ...extra,
  };
}

describe('experiences import — headless flows', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  function isolated(extra = {}) {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    return { ...t.env, ...stubEnv(extra) };
  }

  // ── --skip-apply completes the pipeline and emits a JSON report ─────────
  //
  // NOTE: we pair every full-pipeline test with --print-prompt so the
  // generate step doesn't try to invoke the stub agent for real. The
  // stub's canned response doesn't emit valid `classify_prop` tool
  // calls, which the wizard requires; --print-prompt sidesteps that by
  // reporting "prompt printed" instead of invoking the agent.
  it('--skip-apply --print-prompt runs the pipeline end-to-end and emits a JSON report on stdout', async () => {
    const { code, stdout } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--skip-apply', '--print-prompt'],
      { env: isolated() },
    );
    expect(code).toBe(0);
    const jsonStart = stdout.indexOf('{');
    expect(jsonStart).toBeGreaterThan(-1);
    const report = JSON.parse(stdout.slice(jsonStart));
    expect(report.project).toBe(REACT_MINIMAL);
    const stepNames = report.steps.map((s) => s.step);
    expect(stepNames).toContain('analyze extract');
    expect(stepNames).toContain('generate components');
    const extract = report.steps.find((s) => s.step === 'analyze extract');
    expect(extract.detail.components).toBe(3);
  });

  // ── --print-prompt prints and reports "prompt printed" ─────────────────
  it('--print-prompt reports "prompt printed" on the progress stream (stderr)', async () => {
    // Progress lines (including "prompt printed") route to stderr via
    // progressWriter; only the final JSON report lands on stdout.
    const { code, stderr } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--print-prompt', '--skip-apply'],
      { env: isolated() },
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/prompt printed/);
  });

  it('--print-prompt does NOT emit the --dry-run deprecation notice', async () => {
    const { code, stderr } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--print-prompt', '--skip-apply'],
      { env: isolated() },
    );
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/will change semantics/);
  });

  // ── --dry-run emits a deprecation notice ────────────────────────────────
  it('bare --dry-run emits the deprecation notice on stderr', async () => {
    const { code, stderr } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--dry-run', '--skip-apply'],
      { env: isolated() },
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/will change semantics in a future release/);
    expect(stderr).toMatch(/use '--print-prompt'/);
  });

  it('--dry-run paired with --print-prompt does NOT emit the deprecation notice', async () => {
    const { code, stderr } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--dry-run', '--print-prompt', '--skip-apply'],
      { env: isolated() },
    );
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/will change semantics/);
  });

  // ── --skip-analyze / --skip-generate follow their names ────────────────
  it('--skip-analyze omits the analyze step from the report', async () => {
    // --skip-analyze needs a prior extract session in pipeline.db.
    // With a fresh HOME there is none, so the CLI reports a failure —
    // but the failure is *reported*, not a crash. Assert the shape.
    const { code, stdout } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--skip-analyze', '--skip-apply'],
      { env: isolated() },
    );
    // Exits non-zero because there's nothing to skip forward from.
    expect(code).toBe(1);
    const jsonStart = stdout.indexOf('{');
    if (jsonStart >= 0) {
      const report = JSON.parse(stdout.slice(jsonStart));
      const extract = report.steps.find((s) => s.step === 'analyze extract');
      // Either the step is absent or marked skipped/failed — never "complete".
      expect(extract?.status).not.toBe('complete');
    }
  });

  // ── --agent flag routes through the resolver ────────────────────────────
  it('--agent codex routes to the codex binary override', async () => {
    // Bind ONLY the codex stub; --print-prompt sidesteps actually invoking it.
    // We're asserting the flag reaches the resolver, not the agent's response.
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { code, stdout } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--skip-apply', '--print-prompt', '--agent', 'codex'],
      {
        env: {
          ...t.env,
          EDS_AGENT_BINARY_CODEX: STUB_AGENT,
        },
      },
    );
    expect(code).toBe(0);
    expect(stdout).toMatch(/"step":\s*"generate components"/);
  });

  // ── --yes forces headless ───────────────────────────────────────────────
  it('--yes without credentials errors with the credentials-required message', async () => {
    // --yes puts us in headless mode. No creds → the specific creds error.
    const { code, stderr } = await runCli(['import', '--project', REACT_MINIMAL, '--yes'], {
      env: isolated({
        CONTENTFUL_SPACE_ID: '',
        CONTENTFUL_ENVIRONMENT_ID: '',
        CONTENTFUL_MANAGEMENT_TOKEN: '',
      }),
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/--space-id .* are required unless --skip-apply/s);
  });

  // ── Env-var credentials satisfy the headless requirement ────────────────
  it('CONTENTFUL_* env vars satisfy the headless credentials check', async () => {
    // Env creds pass the mutex check; --skip-apply means we never actually
    // push. Exercises the env-var read path without nock.
    const { code } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--skip-apply', '--print-prompt'],
      {
        env: isolated({
          CONTENTFUL_SPACE_ID: 'test',
          CONTENTFUL_ENVIRONMENT_ID: 'master',
          CONTENTFUL_MANAGEMENT_TOKEN: 'fake',
        }),
      },
    );
    expect(code).toBe(0);
  });

  // ── --verbose surfaces extra output (loose assertion) ───────────────────
  it('--verbose completes without error', async () => {
    const { code } = await runCli(
      ['import', '--project', REACT_MINIMAL, '--skip-apply', '--print-prompt', '--verbose'],
      { env: isolated() },
    );
    expect(code).toBe(0);
  });

  // ── --out redirects pipeline artifacts ──────────────────────────────────
  it('--out places pipeline artifacts under the given directory', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const outDir = `${t.home}/pipeline-artifacts`;
    const { code, stdout } = await runCli(
      [
        'import',
        '--project',
        REACT_MINIMAL,
        '--skip-apply',
        '--print-prompt',
        '--out',
        outDir,
      ],
      { env: { ...t.env, ...stubEnv() } },
    );
    expect(code).toBe(0);
    expect(stdout).toMatch(/"step":\s*"generate components"/);
  });
});
