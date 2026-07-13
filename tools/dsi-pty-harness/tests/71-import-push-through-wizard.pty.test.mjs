/**
 * Tier 3b — driving the wizard from final-review through a real push
 * against mock EMA.
 *
 * The wizard's push flow (from `--modify`):
 *
 *   1. Final-review renders. `[A]` accepts all pending components.
 *   2. `[F]` opens the finalize prompt "Save decisions and exit?".
 *   3. `y` confirms. The push-decision-gate step renders (from
 *      `steps/PushDecisionGateStep.tsx`) with `[b] Save AND push /
 *      [p] Push only / [s] Save only`.
 *   4. `b` picks "Save AND push". The wizard runs `previewImport` (2nd
 *      call, first was the live-preview on entry) and renders the
 *      "Here's what will happen in your space:" confirm screen with
 *      `[Enter] Push to Contentful`.
 *   5. `Enter` fires `applyImport` and polls the operation until
 *      `succeeded`. The final screen shows "Your design system is now
 *      in Contentful ExO."
 *
 * This test asserts the full sequence lands preview + apply requests
 * on the mock. Because it drives the wizard through five real state
 * transitions, keep timeouts generous.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../src/harness.mjs';
import { startMockEma } from './helpers/mock-ema.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { seedRuns } from './helpers/seed-runs.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from './helpers/seed-pipeline-db.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('experiences import → wizard push against mock EMA', () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()();
  });

  async function setup({ breaking = false } = {}) {
    const mock = await startMockEma();
    cleanups.push(() => mock.close());

    const t = makeTmpHome();
    cleanups.push(t.cleanup);

    const { dbPath } = seedPipelineDb(t.home);
    const savePath = join(t.home, 'save');
    mkdirSync(savePath, { recursive: true });
    writeFileSync(join(savePath, 'tokens.json'), '{}\n');

    // The wizard's live-preview reads tokens from
    // <projectPath>/.contentful/tokens.json. Seed that path as well so
    // preview doesn't fail with "file not found: tokens.json".
    const projectPath = join(t.home, 'fake-project');
    mkdirSync(join(projectPath, '.contentful'), { recursive: true });
    writeFileSync(join(projectPath, '.contentful', 'tokens.json'), '{}\n');

    // Seed credentials.json so the modify path (which does NOT prompt
    // for credentials — it enters straight at final-review) can find a
    // host, token, space, and environment. The host points at the mock.
    mkdirSync(join(t.home, '.config', 'experiences'), { recursive: true });
    writeFileSync(
      join(t.home, '.config', 'experiences', 'credentials.json'),
      JSON.stringify({
        spaceId: 'sp1',
        environmentId: 'master',
        cmaToken: 'fake-token',
        host: mock.host,
      }),
    );

    seedRuns(t.home, [
      {
        id: 'run-push',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath,
      },
    ]);

    // Preview response must report at least one non-empty diff bucket
    // or the wizard short-circuits with a "no-op push" banner before
    // reaching the confirm screen. Two shapes:
    //
    //   default:  one "new" component (non-breaking happy path).
    //   breaking: one "changed" component classified as breaking with
    //             non-zero impact so `hasBreakingChangesWithImpact`
    //             returns true and the wizard renders the acknowledge
    //             banner.
    mock.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      const body = breaking
        ? {
            components: {
              new: [],
              changed: [
                {
                  current: { name: 'Button', $id: 'button-id' },
                  proposed: { name: 'Button' },
                  changeClassification: {
                    classification: 'breaking',
                    breakingChanges: [
                      { propertyId: 'label', reason: 'type changed from string to number' },
                    ],
                  },
                  impact: { affectedFragments: 2, affectedExperiences: 1 },
                },
              ],
              unchanged: [],
              removed: [],
            },
            tokens: { new: [], changed: [], unchanged: [], removed: [] },
            taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
          }
        : {
            components: {
              new: [{ id: 'Button', name: 'Button' }],
              changed: [],
              unchanged: [],
              removed: [],
            },
            tokens: { new: [], changed: [], unchanged: [], removed: [] },
            taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
          };
      res.end(JSON.stringify(body));
    });

    return { t, dbPath, mock };
  }

  it('happy path: [A] → [F] → y → [b] → Enter drives preview + apply against the mock', async () => {
    const { t, dbPath, mock } = await setup();

    const w = await spawnWizard(['import', '--modify', 'run-push', '--overwrite'], {
      env: { HOME: t.home, EDS_PIPELINE_DB_PATH: dbPath },
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());

    await w.waitFor(/Button/, { timeout: 15000 });
    w.writeKey('A'); // accept all
    await new Promise((r) => setTimeout(r, 1500));
    w.writeKey('F'); // finalize
    await w.waitFor(/Save decisions and exit\?/, { timeout: 8000 });
    w.writeKey('y'); // confirm
    await w.waitFor(/Save AND push/, { timeout: 8000 });
    w.writeKey('b'); // Save AND push
    // The wizard now re-runs previewImport and renders the push-confirm
    // screen.
    await w.waitFor(/Push to Contentful/, { timeout: 15000 });
    w.writeKey('enter');
    // Wait for the terminal "Your design system is now in Contentful"
    // banner to render; that's the observable signal that applyImport
    // + operation polling completed.
    await w.waitFor(/design system is now in Contentful/, { timeout: 15000 });

    // Assertions on the mock — must have hit both preview and apply.
    const paths = mock.requests.map((r) => r.path);
    const preview = paths.filter((p) => p.endsWith('/imports/preview'));
    const apply = paths.filter((p) => p.endsWith('/imports/apply'));
    expect(preview.length).toBeGreaterThan(0);
    expect(apply.length).toBeGreaterThan(0);

    // --host routing: every request must land on our mock (mock only
    // sees requests routed at it). Cross-check the space/environment
    // segments to confirm the CLI built the URL from the seeded
    // credentials.
    expect(paths.every((p) => /\/spaces\/sp1\/environments\/master\//.test(p))).toBe(true);

    // --cma-token routing: every mutating call must carry the fake
    // bearer we seeded in credentials.json.
    const applyReq = mock.requests.find((r) => r.path.endsWith('/imports/apply'));
    expect(applyReq?.headers.authorization).toBe('Bearer fake-token');
  });

  it('breaking-changes gate: banner renders and Enter acknowledges (acknowledgeBreakingChanges: true in apply body)', async () => {
    const { t, dbPath, mock } = await setup({ breaking: true });

    const w = await spawnWizard(['import', '--modify', 'run-push', '--overwrite'], {
      env: { HOME: t.home, EDS_PIPELINE_DB_PATH: dbPath },
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());

    await w.waitFor(/Button/, { timeout: 15000 });
    w.writeKey('A');
    await new Promise((r) => setTimeout(r, 1500));
    w.writeKey('F');
    await w.waitFor(/Save decisions and exit\?/, { timeout: 8000 });
    w.writeKey('y');
    await w.waitFor(/Save AND push/, { timeout: 8000 });
    w.writeKey('b');
    // The push-confirm screen must include the breaking-changes
    // acknowledge banner (WizardPreviewStep.tsx line 304).
    await w.waitFor(/Breaking changes will affect downstream entities/, {
      timeout: 15000,
    });
    const screen = w.getScreen();
    expect(screen).toMatch(/Press Enter to acknowledge and apply/);
    // Enter passes `acknowledgeBreakingChanges: true` to applyImport.
    w.writeKey('enter');
    await w.waitFor(/design system is now in Contentful/, { timeout: 15000 });

    const applyReq = mock.requests.find((r) => r.path.endsWith('/imports/apply'));
    expect(applyReq).toBeDefined();
    const body = JSON.parse(applyReq.body);
    expect(body.acknowledgeBreakingChanges).toBe(true);
  });
});
