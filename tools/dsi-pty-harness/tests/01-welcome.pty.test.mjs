import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../src/harness.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';

describe('welcome step', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('advances past WelcomeStep once a project path is entered', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(['import'], {
      env: t.env,
      cols: 200,
      rows: 50,
    });
    cleanups.push(() => w.close());

    await w.waitFor('Where is your component library?', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 300));

    const fixture = '/tmp/fake-project';
    for (const ch of fixture) {
      w.writeText(ch);
      await new Promise((r) => setTimeout(r, 5));
    }
    w.writeKey('enter');

    await w.waitFor(/Scanning|files|component|token|✓|✗/i, { timeout: 20000 });

    const screen = w.getScreen();
    expect(
      /Where is your component library\?[\s\S]*Project path:[^\n]*█\s*$/.test(
        screen,
      ),
    ).toBe(false);
  });

  it('renders typed characters in the project-path input', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 50 });
    cleanups.push(() => w.close());

    await w.waitFor('Where is your component library?', { timeout: 15000 });
    for (const ch of 'abc') {
      w.writeText(ch);
      await new Promise((r) => setTimeout(r, 50));
    }
    await w.waitFor(/Project path:\s*abc/, { timeout: 5000 });

    const screen = w.getScreen();
    const lastIdx = screen.lastIndexOf('Project path:');
    expect(lastIdx).toBeGreaterThanOrEqual(0);
    const lastFrame = screen.slice(lastIdx);
    expect(lastFrame).toMatch(/Project path:\s*abc/);
  });

  it('backspace removes the last character', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 50 });
    cleanups.push(() => w.close());

    await w.waitFor('Where is your component library?', { timeout: 15000 });
    for (const ch of 'abcd') {
      w.writeText(ch);
      await new Promise((r) => setTimeout(r, 50));
    }
    // Wait for the last-frame occurrence of "Project path: abcd" to appear
    // before deleting — otherwise a slow render can leave `getScreen()`
    // showing the intermediate state after we've already dispatched the
    // backspaces, which produces flakes under parallel load.
    await w.waitFor(/Project path:\s*abcd/, { timeout: 5000 });
    w.writeKey('backspace');
    await new Promise((r) => setTimeout(r, 100));
    w.writeKey('backspace');
    await new Promise((r) => setTimeout(r, 100));

    // Poll the last frame until the two trailing chars are gone or timeout.
    const deadline = Date.now() + 5000;
    let lastFrame = '';
    while (Date.now() < deadline) {
      const screen = w.getScreen();
      const lastIdx = screen.lastIndexOf('Project path:');
      lastFrame = screen.slice(lastIdx);
      if (/Project path:\s*ab[^cd]/.test(lastFrame)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(lastFrame).toMatch(/Project path:\s*ab[^cd]/);
  });

  it('q quits from the welcome step', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 50 });
    cleanups.push(() => w.close());

    await w.waitFor('Where is your component library?', { timeout: 15000 });
    w.writeText('q');

    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (w.isExited()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(w.isExited()).toBe(true);
  });

  it('esc quits from the welcome step', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 50 });
    cleanups.push(() => w.close());

    await w.waitFor('Where is your component library?', { timeout: 15000 });
    w.writeKey('esc');

    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (w.isExited()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(w.isExited()).toBe(true);
  });

  it('empty enter does not advance', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 50 });
    cleanups.push(() => w.close());

    await w.waitFor('Where is your component library?', { timeout: 15000 });
    w.writeKey('enter');
    await new Promise((r) => setTimeout(r, 600));

    expect(w.isExited()).toBe(false);
    expect(w.getScreen()).toMatch(/Where is your component library\?/);
  });
});
