/**
 * Tier 6 — PTY resize mid-render.
 *
 * Ink installs a SIGWINCH handler; when the terminal resizes the whole
 * frame is re-rendered at the new dimensions. Verify:
 *   - the wizard survives a resize (no crash / no truncated exit)
 *   - post-resize frames render the expected content at the new width
 *
 * The scope-gate is a good target — it renders a wide legend + scrollable
 * list, so a narrow-then-wide resize sequence exercises the layout math.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_MINIMAL } from '../helpers/fixtures.mjs';

describe('PTY resize', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('resizes the terminal mid-render without crashing or exiting', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      ['import', '--project', REACT_MINIMAL, '--no-push', '--no-auto-filter'],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());

    // Reach the scope-gate — a state with a busy layout to stress resize.
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    await w.waitFor(/Components \(3\)/, { timeout: 20000 });

    // Shrink dramatically, then grow. Both events must NOT exit the process.
    w.term.resize(80, 30);
    await new Promise((r) => setTimeout(r, 400));
    expect(w.isExited()).toBe(false);

    w.term.resize(240, 70);
    await new Promise((r) => setTimeout(r, 400));
    expect(w.isExited()).toBe(false);

    // The scope-gate must still be the visible state (post-resize the
    // "Components (3)" section header re-renders in the latest frame).
    const screen = w.getScreen();
    const lastIdx = screen.lastIndexOf('Components (3)');
    expect(lastIdx).toBeGreaterThan(-1);
    // The legend below the list also renders (durable "[q] quit" cue).
    const tail = screen.slice(lastIdx);
    expect(tail).toMatch(/\[q\]/);
  });
});
