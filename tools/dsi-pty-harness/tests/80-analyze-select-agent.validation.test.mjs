/**
 * Tier 5 — `experiences analyze select-agent`.
 *
 * The read-only `--show-rationale` branch is a pure DB read: it re-emits
 * `raw_components.status` + `reject_reason` for a session without any LLM
 * call. Perfect for headless validation tests against the seeded fixture.
 *
 * The seeded pipeline.db (session `true-creek-c44b`) has 3 raw_components
 * with `status='generated'`. formatRationaleTable outputs
 *   Component  Decision  Reason
 *   ---------  --------  ------
 *   Button     generated
 *   Card       generated
 *   Icon       generated
 * (see analyze/select-agent/show-rationale.ts).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from './helpers/seed-pipeline-db.mjs';

describe('analyze select-agent --show-rationale', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('prints a rationale table for the seeded session', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stdout, code } = await runCli(
      ['analyze', 'select-agent', '--show-rationale', '--session', SEEDED_SESSION_ID],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(0);
    // Header + separator + one row per component.
    expect(stdout).toMatch(/Component/);
    expect(stdout).toMatch(/Decision/);
    expect(stdout).toMatch(/Reason/);
    expect(stdout).toMatch(/Button/);
    expect(stdout).toMatch(/Card/);
    expect(stdout).toMatch(/Icon/);
  });

  it('--json emits a machine-readable array', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stdout, code } = await runCli(
      [
        'analyze',
        'select-agent',
        '--show-rationale',
        '--json',
        '--session',
        SEEDED_SESSION_ID,
      ],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(0);
    const rows = JSON.parse(stdout);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(3);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(['Button', 'Card', 'Icon']);
    // Every row has the three documented fields.
    for (const r of rows) {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('decision');
      expect(r).toHaveProperty('reason');
    }
  });

  it('unknown --session exits 1 with a clear error', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stderr, code } = await runCli(
      [
        'analyze',
        'select-agent',
        '--show-rationale',
        '--session',
        'does-not-exist-abc123',
      ],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/Session not found|no components/i);
  });
});
