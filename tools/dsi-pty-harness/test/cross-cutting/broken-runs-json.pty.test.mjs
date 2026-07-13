/**
 * Tier 6 — malformed runs.json handling.
 *
 * `run-picker-mount.ts:shouldShowRunPicker` wraps the JSON.parse in a
 * try/catch and returns `{ shouldShow: false, runs: [] }` on failure —
 * the wizard MUST proceed to Welcome without surfacing an error banner
 * (a garbled runs.json is a soft failure, not a wizard-abort trigger).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';

describe('malformed runs.json', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('non-JSON content is skipped silently; wizard advances to Welcome', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    mkdirSync(join(t.home, '.config', 'experiences'), { recursive: true });
    writeFileSync(
      join(t.home, '.config', 'experiences', 'runs.json'),
      '{not valid json at all',
    );
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());
    await w.waitFor('Where is your component library?', { timeout: 10000 });
    expect(w.getScreen()).not.toMatch(/Found .* prior run/i);
  });

  it('valid JSON with the wrong shape is skipped silently', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    mkdirSync(join(t.home, '.config', 'experiences'), { recursive: true });
    // Missing `version` and `runs` — parses cleanly but doesn't match
    // the RunsFile contract; the picker treats it as no-runs.
    writeFileSync(
      join(t.home, '.config', 'experiences', 'runs.json'),
      JSON.stringify({ nonsense: true }),
    );
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());
    await w.waitFor('Where is your component library?', { timeout: 10000 });
    expect(w.getScreen()).not.toMatch(/Found .* prior run/i);
  });

  it('empty file is skipped silently', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    mkdirSync(join(t.home, '.config', 'experiences'), { recursive: true });
    writeFileSync(join(t.home, '.config', 'experiences', 'runs.json'), '');
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());
    await w.waitFor('Where is your component library?', { timeout: 10000 });
    expect(w.getScreen()).not.toMatch(/Found .* prior run/i);
  });
});
