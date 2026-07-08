/**
 * Tier 3b — `--modify` save-mode flags (`--overwrite`, `--save-as-new`).
 *
 * These flags decide what happens to the "Save to:" prompt after
 * finalize:
 *   --overwrite:   skip the prompt, save to `run.savePath` (from runs.json).
 *   --save-as-new: always render the prompt for a new path.
 *   (neither):     prompt with the recorded path as default.
 *
 * Both require:
 *   - a seeded runs.json (helpers/seed-runs.mjs)
 *   - a seeded pipeline.db with status='generated' components
 *     (helpers/seed-pipeline-db.mjs)
 * so the wizard reaches final-review with real data.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { seedRuns } from '../helpers/seed-runs.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from '../helpers/seed-pipeline-db.mjs';

describe('experiences import --modify save modes', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  function setup(runOverrides = {}) {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    // Seed a tokens.json placeholder at the savePath so the save step
    // doesn't fail looking for it. The runs.json points at savePath.
    const savePath = join(t.home, 'save');
    mkdirSync(savePath, { recursive: true });
    writeFileSync(join(savePath, 'tokens.json'), '{}\n');

    seedRuns(t.home, [
      {
        id: 'run-mod-1',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath: t.home + '/fake-project', // any path — no source check
        ...runOverrides,
      },
    ]);

    return { t, dbPath, savePath };
  }

  async function spawn(args, home, dbPath) {
    const w = await spawnWizard(args, {
      env: { HOME: home, EDS_PIPELINE_DB_PATH: dbPath },
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());
    return w;
  }

  it('--modify reaches final-review with the seeded components loaded', async () => {
    const { t, dbPath } = setup();
    const w = await spawn(
      ['import', '--modify', 'run-mod-1'],
      t.home,
      dbPath,
    );
    // The seeded DB has 3 raw_components (Button, Card, Icon) with
    // status='generated'. loadCDFComponents returns them; the sidebar
    // renders each name.
    await w.waitFor(/Button/, { timeout: 15000 });
    const screen = w.getScreen();
    expect(screen).toMatch(/Button/);
    expect(screen).toMatch(/Card/);
    expect(screen).toMatch(/Icon/);
    // Scope-gate would show "[a] accept / [space] toggle" from the flat
    // list; final-review shows "[F] finalize" and the sidebar layout
    // instead — assert we're at the latter, not the former.
    expect(screen).toMatch(/\[F\]\s*finalize/i);
  });

  it('--modify --overwrite writes components.json to the recorded savePath (no "Save to:" prompt)', async () => {
    const { t, dbPath, savePath } = setup();
    const w = await spawn(
      ['import', '--modify', 'run-mod-1', '--overwrite', '--no-push'],
      t.home,
      dbPath,
    );
    await w.waitFor(/Button/, { timeout: 15000 });
    w.writeKey('A'); // accept all
    await new Promise((r) => setTimeout(r, 1500));
    w.writeKey('F'); // finalize
    await w.waitFor(/Save decisions and exit\?/, { timeout: 8000 });
    w.writeKey('y'); // confirm
    // Save/push chooser
    await w.waitFor(/Save AND push|Save only|Push only/, { timeout: 8000 });
    w.writeKey('s'); // save only
    w.writeKey('enter');
    // Wait for the save step to complete and land the file.
    await new Promise((r) => setTimeout(r, 10000));
    const screen = w.getScreen();
    // The interactive "Save to:" prompt from the wizard's SavePathStep
    // MUST NOT render when --overwrite is set.
    expect(screen).not.toMatch(/\?\s+Save to:/);
    // components.json should exist at the recorded savePath.
    const compsPath = join(savePath, 'components.json');
    expect(existsSync(compsPath)).toBe(true);
    const cdf = JSON.parse(readFileSync(compsPath, 'utf8'));
    expect(cdf.$schema).toMatch(/cdf/i);
    expect(cdf.Button).toBeDefined();
  });

  it('--modify --save-as-new does NOT save to the recorded path silently — a "Save to:" prompt surfaces', async () => {
    const { t, dbPath, savePath } = setup();
    const w = await spawn(
      ['import', '--modify', 'run-mod-1', '--save-as-new', '--no-push'],
      t.home,
      dbPath,
    );
    await w.waitFor(/Button/, { timeout: 15000 });
    w.writeKey('A');
    await new Promise((r) => setTimeout(r, 1500));
    w.writeKey('F');
    await w.waitFor(/Save decisions and exit\?/, { timeout: 8000 });
    w.writeKey('y');
    await w.waitFor(/Save AND push|Save only|Push only/, { timeout: 8000 });
    w.writeKey('s');
    w.writeKey('enter');
    // With --save-as-new the wizard must ask for a new save path.
    await w.waitFor(/\?\s+Save to:/, { timeout: 10000 });
    // And it must NOT have silently written to the recorded savePath.
    expect(existsSync(join(savePath, 'components.json'))).toBe(false);
  });

  // ── Tier 4 — FieldEditor keystroke coverage ───────────────────────────────
  //
  // Reaches the FieldEditor panel from final-review by pressing Tab to move
  // focus from the sidebar to the panel. Uses the seeded pipeline.db so the
  // sidebar renders Button/Card/Icon.
  describe('FieldEditor keystrokes', () => {
    async function reachFieldEditor() {
      const { t, dbPath } = setup();
      const w = await spawn(
        ['import', '--modify', 'run-mod-1', '--no-push'],
        t.home,
        dbPath,
      );
      await w.waitFor(/Button/, { timeout: 15000 });
      await w.waitFor(/FIELDS/, { timeout: 5000 });
      return w;
    }

    it('the FieldEditor panel renders its default row-level mode-label', async () => {
      const w = await reachFieldEditor();
      // Sidebar owns focus initially; the FieldEditor renders in its
      // row-level mode with the default mode-label at the bottom.
      const screen = w.getScreen();
      expect(screen).toMatch(/navigate rows/);
      expect(screen).toMatch(/Ctrl\+S save/);
    });

    it('Enter on a row switches out of row-level mode', async () => {
      const w = await reachFieldEditor();
      w.writeKey('tab');
      await new Promise((r) => setTimeout(r, 400));
      w.writeKey('enter');
      await new Promise((r) => setTimeout(r, 400));
      const screen = w.getScreen();
      const lastIdx = screen.lastIndexOf('FIELDS');
      const lastFrame = screen.slice(lastIdx);
      // Row-level label ("↑↓/jk navigate rows  Enter edit fields ...") must
      // have been replaced with one of the field-level labels.
      expect(lastFrame).not.toMatch(/Enter edit fields/);
      expect(lastFrame).toMatch(/Type to edit|cycle field|Space\/Enter toggle|cycle value|\[a\]dd/);
    });

    it('Esc from field-edit returns to row-level mode-label', async () => {
      const w = await reachFieldEditor();
      w.writeKey('tab');
      await new Promise((r) => setTimeout(r, 300));
      w.writeKey('enter');
      await new Promise((r) => setTimeout(r, 300));
      w.writeKey('esc');
      await new Promise((r) => setTimeout(r, 400));
      const screen = w.getScreen();
      const lastIdx = screen.lastIndexOf('FIELDS');
      const lastFrame = screen.slice(lastIdx);
      expect(lastFrame).toMatch(/navigate rows/);
    });
  });
});
