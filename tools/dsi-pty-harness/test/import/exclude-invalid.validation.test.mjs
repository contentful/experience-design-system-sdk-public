/**
 * Tier 3b — `--exclude-invalid` on the headless `import` path.
 *
 * The `react-invalid` fixture ships two files that both export a
 * component named `Duplicate`, which trips DUPLICATE_COMPONENT_NAME in
 * `analyze/extract/validate.ts`. The fixture also contains one valid
 * component (`Valid`) so the accepted count is non-zero when the invalid
 * ones are dropped.
 *
 * We exercise the select-agent path (no --select-all / --select /
 * --deselect flags), which is where the orchestrator actually forwards
 * `--exclude-invalid`. That path runs the fail-loud gate in
 * `analyze/select-agent/command.ts` — invalid components trip the gate
 * unless the caller opts in. See the coverage-plan doc for the
 * accompanying "orchestrator does not forward --exclude-invalid on the
 * analyze-select branch" note.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '../helpers/run-cli.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_INVALID } from '../helpers/fixtures.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB_AGENT = resolve(HERE, '../../src/stub-agent.mjs');

function stubEnv(extra = {}) {
  return {
    EDS_AGENT_BINARY_CLAUDE: STUB_AGENT,
    EDS_AGENT_BINARY_CODEX: STUB_AGENT,
    EDS_AGENT_BINARY_OPENCODE: STUB_AGENT,
    EDS_AGENT_BINARY_CURSOR: STUB_AGENT,
    ...extra,
  };
}

describe('experiences import --exclude-invalid', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  function isolated(extra = {}) {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    return { ...t.env, ...stubEnv(extra) };
  }

  // ── Without --exclude-invalid, select-agent refuses ─────────────────────
  it('import without --exclude-invalid fails with a DUPLICATE_COMPONENT_NAME error', async () => {
    const { code, stdout, stderr } = await runCli(
      [
        'import',
        '--project',
        REACT_INVALID,
        '--skip-apply',
        '--print-prompt',
      ],
      { env: isolated() },
    );
    expect(code).toBe(1);
    const combined = stdout + stderr;
    expect(combined).toMatch(/refusing select-agent without --exclude-invalid/);
    expect(combined).toMatch(/DUPLICATE_COMPONENT_NAME/);
    // The step must be reported as failed in the JSON report.
    const jsonStart = stdout.indexOf('{');
    if (jsonStart >= 0) {
      const report = JSON.parse(stdout.slice(jsonStart));
      const select = report.steps.find((s) => s.step === 'analyze select');
      expect(select?.status).toBe('failed');
    }
  });

  // ── With --exclude-invalid, the invalid components are auto-dropped ─────
  it('import --exclude-invalid drops the invalid components and completes', async () => {
    const { code, stdout } = await runCli(
      [
        'import',
        '--project',
        REACT_INVALID,
        '--exclude-invalid',
        '--skip-apply',
        '--print-prompt',
      ],
      { env: isolated() },
    );
    expect(code).toBe(0);
    const jsonStart = stdout.indexOf('{');
    expect(jsonStart).toBeGreaterThan(-1);
    const report = JSON.parse(stdout.slice(jsonStart));
    const extract = report.steps.find((s) => s.step === 'analyze extract');
    const select = report.steps.find((s) => s.step === 'analyze select');
    // 3 files scanned → 3 components extracted (both `Duplicate`s counted).
    expect(extract.detail.components).toBe(3);
    // With --exclude-invalid, the fail-loud gate no longer trips: the
    // select step is reported complete instead of failed.
    expect(select.status).toBe('complete');
  });
});
