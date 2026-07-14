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
import { mkdirSync, writeFileSync } from 'node:fs';
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

    // Seed <projectPath>/.contentful/tokens.json — the wizard's
    // live-preview reads tokens from this exact path on entry to
    // final-review and errors "file not found" if it's absent.
    const projectPath = join(t.home, 'fake-project');
    mkdirSync(join(projectPath, '.contentful'), { recursive: true });
    writeFileSync(join(projectPath, '.contentful', 'tokens.json'), '{}\n');

    seedRuns(t.home, [
      {
        id: 'run-mod-1',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath,
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
