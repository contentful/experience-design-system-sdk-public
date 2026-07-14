/**
 * Regression guard: ESC[2J (full-clear) must not fire during normal navigation
 * at small terminal heights. A 2J mid-keystroke causes visible flicker.
 *
 * Ink rerenders the full frame on every state change but should use cursor
 * positioning (ESC[H or ESC[<row>;<col>H) rather than a full clear-screen
 * sequence. If ESC[2J appears after a navigation keystroke, Ink fell back to
 * the destructive clear path — a regression we want to catch early.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_MINIMAL } from '../helpers/fixtures.mjs';

describe('flicker guard — no ESC[2J on navigation keystrokes', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  async function reachScopeGateAt(rows, cols = 120) {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      ['import', '--project', REACT_MINIMAL, '--no-push', '--no-auto-filter'],
      { env: t.env, cols, rows },
    );
    cleanups.push(() => w.close());
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    await w.waitFor(/Extraction complete/, { timeout: 20000 });
    return w;
  }

  for (const rows of [20, 24, 30]) {
    it(`rows=${rows}: pressing [j] does not emit ESC[2J`, async () => {
      const w = await reachScopeGateAt(rows);

      // Snapshot the raw buffer length before the keystroke.
      const rawBefore = w.getRaw();
      const lenBefore = rawBefore.length;

      w.writeKey('j');
      await new Promise((r) => setTimeout(r, 400));

      // Count ESC[2J occurrences in the delta produced by this keystroke.
      const delta = w.getRaw().slice(lenBefore);
      const fullClearCount = (delta.match(/\x1b\[2J/g) ?? []).length;

      expect(fullClearCount).toBe(0);
    });
  }
});
