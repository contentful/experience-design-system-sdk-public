import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';

function seedRunsJson(home, count = 1) {
  const dir = join(home, '.config', 'experiences');
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const runs = [];
  for (let i = 0; i < count; i++) {
    runs.push({
      id: `run-stub-${String(i).padStart(4, '0')}`,
      createdAt: now,
      updatedAt: now,
      kind: 'import',
      status: 'completed',
      projectPath: '/tmp/fake-project',
      title: `seeded stub run ${i}`,
      sessionId: `sess-stub-${i}`,
      steps: [],
    });
  }
  writeFileSync(
    join(dir, 'runs.json'),
    JSON.stringify({ version: 3, runs }, null, 2),
  );
}

describe('run-picker', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('offers to start a new run when prior runs exist', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsJson(t.home);

    const w = await spawnWizard(['import'], { env: t.env });
    cleanups.push(() => w.close());

    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    w.writeKey('n');
    await w.waitFor('Where is your component library?', { timeout: 8000 });

    expect(w.getScreen()).toMatch(/Where is your component library/);
  });

  it('j moves focus down to the [n] Start-a-new-run row', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsJson(t.home, 2);

    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());

    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    // Two runs + [n] Start a new run. Move down twice: from run-0000 to run-0001 to [n].
    w.writeKey('j');
    await new Promise((r) => setTimeout(r, 200));
    w.writeKey('j');
    await new Promise((r) => setTimeout(r, 400));

    const screen = w.getScreen();
    const lastIdx = screen.lastIndexOf('Found ');
    const lastFrame = screen.slice(lastIdx);
    expect(lastFrame).toMatch(/>\s*\[n\] Start a new run/);
  });

  it('k wraps focus upward', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsJson(t.home, 2);

    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());

    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    // From index 0, k wraps to last row ([n] Start a new run).
    w.writeKey('k');
    await new Promise((r) => setTimeout(r, 400));

    const screen = w.getScreen();
    const lastIdx = screen.lastIndexOf('Found ');
    const lastFrame = screen.slice(lastIdx);
    expect(lastFrame).toMatch(/>\s*\[n\] Start a new run/);
  });

  it('Enter on a run row opens Push/Modify sub-screen', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsJson(t.home, 1);

    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());

    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    w.writeKey('enter');
    await w.waitFor('Push or modify?', { timeout: 5000 });
    expect(w.getScreen()).toMatch(/Push or modify\?/);
  });

  it('Esc from the Push/Modify sub-screen returns to the run list', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsJson(t.home, 1);

    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());

    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    w.writeKey('enter');
    await w.waitFor('Push or modify?', { timeout: 5000 });
    w.writeKey('esc');
    await new Promise((r) => setTimeout(r, 500));

    const screen = w.getScreen();
    const lastFoundIdx = screen.lastIndexOf('Found ');
    const lastPushIdx = screen.lastIndexOf('Push or modify?');
    // The picker was re-rendered after the sub-screen.
    expect(lastFoundIdx).toBeGreaterThan(lastPushIdx);
  });

  it('q quits from the run-picker', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsJson(t.home, 1);

    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());

    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    w.writeText('q');

    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (w.isExited()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(w.isExited()).toBe(true);
  });
});
