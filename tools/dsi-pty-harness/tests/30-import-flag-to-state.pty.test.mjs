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
import { spawnWizard } from '../src/harness.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { REACT_MINIMAL } from './helpers/fixtures.mjs';

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
    const stripped = w.getScreen();
    const raw = w.getRaw();
    // Scope-gate bindings must never have rendered.
    expect(stripped).not.toMatch(/\[a\]\s*accept/i);
    expect(stripped).not.toMatch(/\[space\]\s*toggle/i);
    // Positive: the auto-accept banner appears at least briefly in the
    // raw transcript (Ink may overwrite it visually before we sample).
    expect(raw).toMatch(/Auto-accepting|components accepted/);
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
    const stubAgent = new URL('../src/stub-agent.mjs', import.meta.url).pathname;
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
});
