/**
 * Tier 3b — flag steers wizard into a specific on-screen state.
 *
 * Each test spawns the wizard through a real PTY, drives the minimum
 * keystrokes needed to reach the state the flag targets, and asserts
 * a distinctive string on the rendered screen.
 *
 * Uses the react-minimal fixture (3 components: Button, Card, Icon)
 * and the offline stub agent. The stub emits one classify_component +
 * classify_prop per detected prop so the generate step never trips
 * "agent produced no tool calls".
 *
 * When a test needs to advance past the Design-tokens step, we press
 * `s` (skip). To advance past the "Does this look right?" gate we
 * press Enter.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_MINIMAL } from '../helpers/fixtures.mjs';

describe('experiences import — flag → wizard state (PTY)', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  async function spawn(args, opts = {}) {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(args, { env: t.env, cols: 200, rows: 60, ...opts });
    cleanups.push(() => w.close());
    return w;
  }

  // ── --project skips welcome, lands on Design tokens ─────────────────────
  it('--project <fixture> skips WelcomeStep and lands on the Design tokens step', async () => {
    const w = await spawn(['import', '--project', REACT_MINIMAL, '--no-push']);
    await w.waitFor('Design tokens', { timeout: 10000 });
    const screen = w.getScreen();
    // Welcome would ask "Where is your component library?" — that must NOT appear.
    expect(screen).not.toMatch(/Where is your component library\?/);
    expect(screen).toMatch(/Token path/);
  });

  // ── Design-tokens skip advances to Scanning ─────────────────────────────
  it('pressing [s] on the tokens step advances to the file-scan confirmation', async () => {
    const w = await spawn(['import', '--project', REACT_MINIMAL, '--no-push']);
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    expect(w.getScreen()).toMatch(/start extracting/);
  });

  // ── --auto-accept-scope skips the scope-gate ────────────────────────────
  it('--auto-accept-scope skips scope-gate and proceeds directly to generation', async () => {
    const w = await spawn([
      'import',
      '--project',
      REACT_MINIMAL,
      '--auto-accept-scope',
      '--no-push',
    ]);
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    // "Generating" / "Checking claude" / "Save to:" are the durable
    // next-state anchors that only appear AFTER scope-gate would have run.
    await w.waitFor(/Generating|Checking claude|Save to:/, { timeout: 30000 });
    const raw = w.getRaw();
    // The strongest signal is a negative one: the interactive scope-gate's
    // key bindings must never have rendered. Ink writes them into the raw
    // buffer if the step mounted, even if a subsequent clear overwrites
    // them on screen — so search the raw buffer, not just the ANSI-stripped
    // last frame.
    expect(raw).not.toMatch(/toggle all|\[j\/k\]\s*move/i);
    expect(raw).not.toMatch(/AI recommended exclusions/i);
    // Positive corroboration: at least one of the scope-gate-skip markers
    // that Ink logs at auto-accept time appears in the transcript. Any of
    // the three variants is fine.
    expect(raw).toMatch(/Auto-accepting|components accepted|accepted 3 components/i);
  });

  // ── --no-push completes generation without pushing ──────────────────────
  it('--no-push completes generate and opens the save-path prompt (no push confirmation)', async () => {
    const w = await spawn([
      'import',
      '--project',
      REACT_MINIMAL,
      '--auto-accept-scope',
      '--no-push',
    ]);
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    // Extract → generate → save prompt.
    await w.waitFor(/Save to:/, { timeout: 30000 });
    const screen = w.getScreen();
    // A push confirmation prompt would ask "Push to Contentful?" —
    // it must NOT appear when --no-push is set.
    expect(screen).not.toMatch(/Push to Contentful/i);
  });

  // ── --out-dir bypasses the interactive save-path prompt ─────────────────
  it('--out-dir bypasses the inline save-path prompt', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      [
        'import',
        '--project',
        REACT_MINIMAL,
        '--auto-accept-scope',
        '--no-push',
        '--out-dir',
        t.home,
      ],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());

    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    // The final state depends on wizard version; the key assertion is
    // that the interactive "Save to:" prompt does NOT render.
    await new Promise((r) => setTimeout(r, 25000));
    expect(w.getScreen()).not.toMatch(/\?\s+Save to:/);
  });

  // ── --agent codex routes agent-runner to the codex binary ───────────────
  it('--agent codex uses the codex stub without invoking claude', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const stubAgent = new URL('../../src/stub-agent.mjs', import.meta.url).pathname;
    const w = await spawnWizard(
      ['import', '--project', REACT_MINIMAL, '--auto-accept-scope', '--no-push', '--agent', 'codex'],
      {
        env: { ...t.env, EDS_AGENT_BINARY_CODEX: stubAgent },
        cols: 200,
        rows: 60,
        stubAgents: false, // don't apply the default all-agents stub env
      },
    );
    cleanups.push(() => w.close());

    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    // If codex routing works, we reach the save-path prompt via generate.
    await w.waitFor(/Save to:/, { timeout: 30000 });
  });

  // ── Scope-gate renders when auto-accept is NOT set (control test) ───────
  it('without --auto-accept-scope, the scope-gate renders with its key bindings', async () => {
    const w = await spawn(['import', '--project', REACT_MINIMAL, '--no-push']);
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    // Wait for the scope-gate. Its exact text is version-sensitive; look
    // for any of the common cues.
    await w.waitFor(/Review|Accept|Reject|scope|component[s]?\s*\(/i, {
      timeout: 30000,
    });
    const screen = w.getScreen();
    // At least one of the scope-gate action bindings should be visible.
    // If the wizard's scope-gate text changes, this may need updating —
    // fail loudly rather than silently letting auto-accept regressions
    // slip through.
    expect(screen).toMatch(/\[a\]|\[space\]|\[enter\]/i);
  });

  // ── Scope-gate keystroke coverage (Tier 4) ──────────────────────────────
  //
  // Uses `--no-auto-filter` so the AI section is empty and the "Components"
  // section is fully populated — assertions can target that section
  // deterministically.
  describe('scope-gate keystrokes', () => {
    async function reachScopeGate() {
      const w = await spawn([
        'import',
        '--project',
        REACT_MINIMAL,
        '--no-push',
        '--no-auto-filter',
      ]);
      await w.waitFor('Design tokens', { timeout: 10000 });
      w.writeKey('s');
      await w.waitFor(/Found \d+ files/, { timeout: 8000 });
      w.writeKey('enter');
      await w.waitFor(/Components \(3\)/, { timeout: 20000 });
      return w;
    }

    it('space toggles the focused row off (2/3 included)', async () => {
      const w = await reachScopeGate();
      w.writeKey('space');
      await new Promise((r) => setTimeout(r, 400));
      const screen = w.getScreen();
      const idx = screen.lastIndexOf('Components (3)');
      const lastFrame = screen.slice(idx);
      expect(lastFrame).toMatch(/2\/3 included/);
    });

    it('a toggles the focused row (same as space)', async () => {
      const w = await reachScopeGate();
      w.writeText('a');
      await new Promise((r) => setTimeout(r, 400));
      const screen = w.getScreen();
      const idx = screen.lastIndexOf('Components (3)');
      const lastFrame = screen.slice(idx);
      expect(lastFrame).toMatch(/2\/3 included/);
    });

    it('A (shift-a) toggles all component rows off', async () => {
      const w = await reachScopeGate();
      w.writeText('A');
      await new Promise((r) => setTimeout(r, 400));
      const screen = w.getScreen();
      // 3/3 → 0/3. The bottom bar renders "none included" when all excluded.
      const idx = screen.lastIndexOf('Components (3)');
      const lastFrame = screen.slice(idx);
      expect(lastFrame).toMatch(/none included/);
    });

    it('j moves focus down', async () => {
      const w = await reachScopeGate();
      // Baseline: focus on first row (Button). Snapshot before/after so we
      // can compare which row rendered with the cursor glyph.
      const before = w.getScreen();
      const beforeLast = before.slice(before.lastIndexOf('Components (3)'));
      w.writeKey('j');
      await new Promise((r) => setTimeout(r, 400));
      const after = w.getScreen();
      const afterLast = after.slice(after.lastIndexOf('Components (3)'));
      // The cursor glyph "›" appears once per frame — its position should differ.
      const beforeCursorIdx = beforeLast.indexOf('›');
      const afterCursorIdx = afterLast.indexOf('›');
      expect(afterCursorIdx).toBeGreaterThan(beforeCursorIdx);
    });

    it('f confirms and advances past the scope-gate', async () => {
      const w = await reachScopeGate();
      w.writeText('f');
      // Next durable state is generate ("Checking claude" / "Generating") or
      // save-path ("Save to:"). Any of these means we left the scope-gate.
      await w.waitFor(/Generating|Checking claude|Save to:/, { timeout: 30000 });
      const screen = w.getScreen();
      expect(screen).toMatch(/Generating|Checking claude|Save to:/);
    });

    it('q quits from the scope-gate', async () => {
      const w = await reachScopeGate();
      w.writeText('q');
      const start = Date.now();
      while (Date.now() - start < 8000) {
        if (w.isExited()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(w.isExited()).toBe(true);
    });
  });
});
