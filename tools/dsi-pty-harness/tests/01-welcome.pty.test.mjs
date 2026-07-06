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
});
