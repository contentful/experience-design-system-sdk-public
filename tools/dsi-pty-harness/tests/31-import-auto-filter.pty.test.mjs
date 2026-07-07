/**
 * Tier 3b — `--auto-filter` / `--no-auto-filter` steer the scope-gate.
 *
 * Default (no flag): the wizard runs the AI-filter step before showing
 * the scope-gate, which renders an "[AI filtering (N/M)…]" banner and
 * an "AI recommended exclusions" section. With --no-auto-filter, both
 * are absent — the scope-gate lists components without AI input.
 * With --auto-filter, the banner + section appear (overrides any
 * stored autoFilter=false preference).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../src/harness.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { REACT_MINIMAL } from './helpers/fixtures.mjs';

describe('experiences import — AI-filter flags (PTY)', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  async function reachScopeGate(args) {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(args, { env: t.env, cols: 200, rows: 60 });
    cleanups.push(() => w.close());
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    // Scope-gate: any of these key bindings signals we've arrived.
    await w.waitFor(/\[a\/space\]|\[f\]\s*continue|Components \(\d+\)/i, {
      timeout: 20000,
    });
    return w;
  }

  it('--auto-filter renders the AI-filtering banner and the "AI recommended exclusions" section', async () => {
    const w = await reachScopeGate([
      'import',
      '--project',
      REACT_MINIMAL,
      '--no-push',
      '--auto-filter',
    ]);
    // Give the AI filter a moment to run (stub agent's select-agent
    // step emits no tool calls, so it "excludes" every component).
    await new Promise((r) => setTimeout(r, 3000));
    const stripped = w.getScreen();
    const raw = w.getRaw();
    // The banner may flash by; check both the stripped screen and the
    // raw append-only buffer.
    const anywhere = stripped + '\n' + raw;
    expect(anywhere).toMatch(/AI filtering|AI recommended exclusions|excluded.*by AI/i);
  });

  it('--no-auto-filter shows the scope-gate with NO filter banner and NO AI-recommended-exclusions section', async () => {
    const w = await reachScopeGate([
      'import',
      '--project',
      REACT_MINIMAL,
      '--no-push',
      '--no-auto-filter',
    ]);
    await new Promise((r) => setTimeout(r, 2500));
    const stripped = w.getScreen();
    // Neither the filtering-in-progress banner NOR the exclusions
    // section may render.
    expect(stripped).not.toMatch(/AI filtering/i);
    expect(stripped).not.toMatch(/AI recommended exclusions/i);
    expect(stripped).not.toMatch(/originally excluded by AI/i);
    // Positive: scope-gate rendered with the three fixture components
    // all included by default.
    expect(stripped).toMatch(/Components \(3\)/);
    expect(stripped).toMatch(/\[✓\]\s*Button/);
    expect(stripped).toMatch(/\[✓\]\s*Card/);
    expect(stripped).toMatch(/\[✓\]\s*Icon/);
  });
});
