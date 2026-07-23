/**
 * Added-components column scroll at large N (composite scope-gate).
 *
 * Regression coverage for two bugs: (1) duplicate rows / non-unique React keys
 * when a repo has name-colliding components, and (2) the column "growing
 * infinitely" instead of windowing. Uses react-composite-cycle (24 components)
 * at a short terminal height so the accepted set overflows the window.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_COMPOSITE_CYCLE } from '../helpers/fixtures.mjs';

describe('scope-gate added-components column scroll (PTY)', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  async function reachScopeGate() {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    // Wide enough for the three-column layout (>=120), short enough that 24
    // accepted rows overflow the added-components window.
    const w = await spawnWizard(
      ['import', '--project', REACT_COMPOSITE_CYCLE, '--no-push', '--no-auto-filter', '--composite'],
      { env: t.env, cols: 200, rows: 24 },
    );
    cleanups.push(() => w.close());
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    await w.waitFor(/Extraction complete/, { timeout: 30000 });
    return w;
  }

  it('accept-all then focus added column: windows (does not grow past the frame) and has no dupes', async () => {
    const w = await reachScopeGate();
    // Accept all non-flagged, then Tab into the added-components column.
    w.writeText('Y');
    await new Promise((r) => setTimeout(r, 400));
    w.writeKey('tab');
    await new Promise((r) => setTimeout(r, 300));

    const screen = w.getScreen();
    const region = screen.slice(screen.lastIndexOf('Added components'));

    // The frame must not overflow the 24-row terminal: the added column's
    // rendered body is bounded, so a windowing indicator appears rather than
    // every accepted component printing at once.
    const hasWindowIndicator = /↑\s*\d+\s*more|↓\s*\d+\s*more/.test(region);
    expect(hasWindowIndicator).toBe(true);

    // No duplicate component rows in the visible added column. Collect the
    // component-name tokens on rendered rows and assert uniqueness.
    const rowNames = [...region.matchAll(/^\s*[▶ ]\s*(?:\[.\]\s*)?([A-Z][A-Za-z0-9]+)\s*$/gm)].map((m) => m[1]);
    const seen = new Set();
    const dupes = rowNames.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    expect(dupes).toEqual([]);
  });

  it('scrolling down in the added column keeps the window bounded (no infinite growth)', async () => {
    const w = await reachScopeGate();
    w.writeText('Y');
    await new Promise((r) => setTimeout(r, 400));
    w.writeKey('tab');
    await new Promise((r) => setTimeout(r, 300));

    const countAddedRows = () => {
      const s = w.getScreen();
      const region = s.slice(s.lastIndexOf('Added components'), s.indexOf('Added groups') >= 0 ? s.indexOf('Added groups') : undefined);
      return (region.match(/\[✓\]|\[✗\]|›\s|▶/g) ?? []).length;
    };
    const before = countAddedRows();
    // Scroll well past a screenful.
    for (let i = 0; i < 20; i += 1) {
      w.writeKey('j');
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 300));
    const after = countAddedRows();
    // The rendered row count stays in the same bounded ballpark — it must NOT
    // have grown with every keystroke.
    expect(after).toBeLessThanOrEqual(before + 3);
  });
});
