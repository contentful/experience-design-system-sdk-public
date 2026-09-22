/**
 * Flag-matrix PTY cells (Phase 1) — composition × PTY mode and
 * --auto-reject-cycles × PTY mode.
 *
 * These are the interactive-dispatcher halves of the regression firewall
 * defined in test/import/flag-matrix/. The headless halves live in the main
 * vitest suite; these prove the SAME flags have an observable effect in the
 * Ink wizard, which the shipped composition bug did not.
 *
 * Opt-in via PTY_TESTS=1 (runs against dist/). The guard below makes an
 * unset-env run FAIL LOUDLY rather than silently reporting green, so the
 * matrix's PTY coverage cannot rot unnoticed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_MINIMAL, REACT_COMPOSITE_CYCLE } from '../helpers/fixtures.mjs';

const PTY_ENABLED = process.env.PTY_TESTS === '1';

describe('flag-matrix PTY cells — env gate', () => {
  it('PTY_TESTS must be set for the flag-matrix PTY cells to count as verified', () => {
    expect(
      PTY_ENABLED,
      'PTY cells NOT verified: run with PTY_TESTS=1 against a built dist/ to exercise the composition × PTY and cycle × PTY matrix cells',
    ).toBe(true);
  });
});

const suite = PTY_ENABLED ? describe : describe.skip;

suite('flag-matrix: composition flags in the INTERACTIVE (PTY) dispatcher', () => {
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

  it('--composite renders the hierarchy-aware scope-gate (groups/cycle machinery)', async () => {
    const w = await reachScopeGate(['--composite']);
    const screen = w.getScreen().slice(w.getScreen().lastIndexOf('Extraction complete'));
    expect(screen).toMatch(/Groups|cycle/i);
  });

  it('default (atomic) suppresses the hierarchy affordances the composite step shows', async () => {
    const w = await reachScopeGate([]);
    const screen = w.getScreen().slice(w.getScreen().lastIndexOf('Extraction complete'));
    expect(screen).not.toMatch(/\(cycle\)/i);
    expect(screen).not.toMatch(/Added groups/i);
  });

  it('--generate-map implies composite and reaches the composite scope-gate', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const skeleton = `${t.home}/skeleton.json`;
    const w = await spawnWizard(
      ['import', '--project', REACT_COMPOSITE_CYCLE, '--no-push', '--no-auto-filter', '--generate-map', skeleton],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    await w.waitFor(/Extraction complete/, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const screen = w.getScreen().slice(w.getScreen().lastIndexOf('Extraction complete'));
    expect(screen).toMatch(/Groups|cycle/i);
  });
});

suite('flag-matrix: --auto-reject-cycles in the INTERACTIVE (PTY) dispatcher', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  async function reachScopeGate(extraArgs) {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      ['import', '--project', REACT_COMPOSITE_CYCLE, '--no-push', '--no-auto-filter', '--composite', ...extraArgs],
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

  // The interactive dispatcher accepts --auto-reject-cycles (proving it is
  // wired into the wizard, unlike before the fix). The authoritative
  // behavioral firewall for the auto-reject *decision* is the deterministic
  // headless cell in auto-reject-cycles-headless-matrix.test.ts; here we prove
  // the flag reaches the wizard and the composite scope-gate surfaces cycles.
  it('--auto-reject-cycles + --composite reaches the cycle-aware scope-gate', async () => {
    const w = await reachScopeGate(['--auto-reject-cycles']);
    const screen = w.getScreen().slice(w.getScreen().lastIndexOf('Extraction complete'));
    expect(screen).toMatch(/cycle|Groups/i);
    expect(w.isExited()).toBe(false);
  });

  it('without --auto-reject-cycles, the composite scope-gate still exposes cycle awareness (control)', async () => {
    const w = await reachScopeGate([]);
    const screen = w.getScreen().slice(w.getScreen().lastIndexOf('Extraction complete'));
    expect(screen).toMatch(/cycle|Groups/i);
  });
});
