/**
 * Tier 4 — CredentialsStep keystroke coverage.
 *
 * Reaches the credentials step via `--project <fixture> --auto-accept-scope`.
 * With push enabled (default) and a non-empty accepted set, the scope-gate's
 * auto-advance routes to `step: 'credentials'` (see WizardApp.tsx
 * `advanceToPushFlow`) — generate runs in the background so this is fast.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../src/harness.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { REACT_MINIMAL } from './helpers/fixtures.mjs';

describe('experiences import — CredentialsStep keystrokes', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  async function reachCredentials() {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      ['import', '--project', REACT_MINIMAL, '--auto-accept-scope'],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());

    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    // Credentials step renders once the scope-gate auto-advances.
    await w.waitFor(/Space ID/, { timeout: 30000 });
    return w;
  }

  it('typing populates the active (Space ID) field', async () => {
    const w = await reachCredentials();
    // Type one char at a time — writeText('abc123') can arrive as a single
    // input event that useImmediateInput treats as one keystroke, so only
    // the first character lands.
    for (const ch of 'abc123') {
      w.writeText(ch);
      await new Promise((r) => setTimeout(r, 50));
    }
    await w.waitFor(/Space ID:\s*abc123/, { timeout: 5000 });
    const screen = w.getScreen();
    const idx = screen.lastIndexOf('Space ID:');
    const lastFrame = screen.slice(idx);
    expect(lastFrame).toMatch(/Space ID:\s*abc123/);
  });

  it('tab cycles Space ID → Environment → CMA Token → API Host', async () => {
    const w = await reachCredentials();
    // Initial active: Space ID. Tab three times.
    w.writeKey('tab');
    await new Promise((r) => setTimeout(r, 200));
    w.writeKey('tab');
    await new Promise((r) => setTimeout(r, 200));
    w.writeKey('tab');
    await new Promise((r) => setTimeout(r, 400));
    // API Host active → typing lands in host field; hint line renders.
    w.writeText('x');
    await new Promise((r) => setTimeout(r, 400));
    const screen = w.getScreen();
    // The default host is `api.contentful.com`; typing appends `x`.
    expect(screen).toMatch(/API Host:.*x/);
    // The host-specific hint only renders when host is active.
    expect(screen).toMatch(/EU spaces/);
  });

  it('Enter on the last field with empty required fields shows an inline error', async () => {
    const w = await reachCredentials();
    // Advance through the 4 fields via Enter without typing anything.
    // Space ID (empty) → Enter cycles to Environment (has default 'master').
    // Then Enter → CMA Token, Enter → Host, Enter → submit attempt.
    w.writeKey('enter');
    await new Promise((r) => setTimeout(r, 150));
    w.writeKey('enter');
    await new Promise((r) => setTimeout(r, 150));
    w.writeKey('enter');
    await new Promise((r) => setTimeout(r, 150));
    w.writeKey('enter');
    await new Promise((r) => setTimeout(r, 600));

    const screen = w.getScreen();
    expect(screen).toMatch(/All fields are required/);
  });

  it('backspace removes characters from the active field', async () => {
    const w = await reachCredentials();
    for (const ch of 'abcd') {
      w.writeText(ch);
      await new Promise((r) => setTimeout(r, 50));
    }
    await w.waitFor(/Space ID:\s*abcd/, { timeout: 5000 });
    w.writeKey('backspace');
    w.writeKey('backspace');
    const deadline = Date.now() + 5000;
    let lastFrame = '';
    while (Date.now() < deadline) {
      const screen = w.getScreen();
      const i = screen.lastIndexOf('Space ID:');
      lastFrame = screen.slice(i);
      if (/Space ID:\s*ab[^cd]/.test(lastFrame)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(lastFrame).toMatch(/Space ID:\s*ab[^cd]/);
  });

  it('q quits from the credentials step', async () => {
    const w = await reachCredentials();
    // Small settle to make sure the CredentialsStep has actually mounted
    // and installed its input handler — the "Space ID" marker in
    // reachCredentials can appear via an earlier render frame that's still
    // being processed under parallel load.
    await new Promise((r) => setTimeout(r, 500));
    w.writeText('q');
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (w.isExited()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!w.isExited()) {
      // Retry once — some environments swallow the first keystroke while
      // Ink is finalizing a re-render.
      w.writeText('q');
      const retryStart = Date.now();
      while (Date.now() - retryStart < 5000) {
        if (w.isExited()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(w.isExited()).toBe(true);
  });
});
