/**
 * Atomic vs composite mode (spec T9) — real-PTY render assertions.
 *
 * The default mode is atomic: the scope-gate renders the pre-composite flat
 * step with NO hierarchy affordances (no group columns, lineage, cycle
 * badges, or the composite-only [E]/[C]/[l] keybindings). Passing --composite
 * opts into the grouped/hierarchy-aware step.
 *
 * Uses the react-composite-cycle fixture (has slot composition + a cycle) so
 * the composite step has something to render groups/cycles from, and the
 * atomic step's suppression of all of it is meaningful.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_COMPOSITE_CYCLE } from '../helpers/fixtures.mjs';

describe('experiences import — atomic vs composite scope-gate (PTY)', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  async function reachScopeGate(extraArgs) {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      ['import', '--project', REACT_COMPOSITE_CYCLE, '--no-push', '--no-auto-filter', ...extraArgs],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    await w.waitFor(/Extraction complete/, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    return w;
  }

  it('default (atomic) renders the flat step with NO hierarchy affordances', async () => {
    const w = await reachScopeGate([]);
    const screen = w.getScreen().slice(w.getScreen().lastIndexOf('Extraction complete'));
    // Flat-step chrome present.
    expect(screen).toMatch(/\[a\/space\]|\[a\]/);
    expect(screen).toMatch(/\[f\]/);
    // Hierarchy affordances ABSENT.
    expect(screen).not.toMatch(/\(cycle\)/i);
    expect(screen).not.toMatch(/lineage/i);
    expect(screen).not.toMatch(/Added groups/i);
    expect(screen).not.toMatch(/Only cycles/i);
    // Atomic legend advertises none of the composite-only view keys.
    expect(screen).not.toMatch(/\[l\]\s*lineage/i);
  });

  it('--composite renders the hierarchy-aware step (groups/cycle machinery present)', async () => {
    const w = await reachScopeGate(['--composite']);
    const screen = w.getScreen().slice(w.getScreen().lastIndexOf('Extraction complete'));
    // The composite step carries a Groups counter and cycle guidance the
    // atomic step never shows.
    expect(screen).toMatch(/Groups|cycle/i);
  });
});
