import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('ctrl-c signal handling', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('exits the wizard cleanly', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);

    const w = await spawnWizard(['import'], { env: t.env });
    cleanups.push(() => w.close());
    const pid = w.term.pid;

    await w.waitFor('Where is your component library?', { timeout: 10000 });
    w.writeKey('ctrl-c');

    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (!isProcessAlive(pid)) return;
      await new Promise((r) => setTimeout(r, 100));
    }

    w.writeKey('ctrl-c');
    await new Promise((r) => setTimeout(r, 500));
    expect(isProcessAlive(pid)).toBe(false);
  });
});
