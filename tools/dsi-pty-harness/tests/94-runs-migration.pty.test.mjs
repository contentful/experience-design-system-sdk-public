/**
 * Tier 6 — runs.json v1 → v3 auto-migration.
 *
 * `runs/store.ts:migrateRecord` lifts v1 and v2 records into the current
 * v3 in-memory shape before the picker consumes them. The picker's
 * displayed line renders every migrated record's `id`, `createdAt`,
 * `projectPath`, and `componentCount`, so a durable assertion is: the
 * seeded id appears in the picker's screen.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../src/harness.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { seedRunsV1, seedRunsV2 } from './helpers/seed-runs-legacy.mjs';

describe('runs.json version migration', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('v1 records surface in the run-picker', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsV1(t.home, [
      { id: 'legacy-v1-run-abc', projectPath: '/tmp/fake-project-v1' },
    ]);
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());
    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    expect(w.getScreen()).toMatch(/legacy-v1-run-abc/);
  });

  it('v2 records surface in the run-picker', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsV2(t.home, [
      { id: 'legacy-v2-run-def', projectPath: '/tmp/fake-project-v2' },
    ]);
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());
    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    expect(w.getScreen()).toMatch(/legacy-v2-run-def/);
  });

  it('unknown-version runs.json is skipped silently — wizard falls through to welcome', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    // Version 99 is outside READABLE_VERSIONS. `shouldShowRunPicker`
    // returns `{ shouldShow: false, runs: [] }` for that case (see
    // runs/run-picker-mount.ts), so the wizard MUST proceed straight to
    // WelcomeStep without an error banner.
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(join(t.home, '.config', 'experiences'), { recursive: true });
    writeFileSync(
      join(t.home, '.config', 'experiences', 'runs.json'),
      JSON.stringify({ version: 99, runs: [] }),
    );
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());
    await w.waitFor('Where is your component library?', { timeout: 10000 });
    // The run-picker must NOT have rendered.
    expect(w.getScreen()).not.toMatch(/Found .* prior run/i);
  });
});
