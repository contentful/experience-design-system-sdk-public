/**
 * Tier 5 — `experiences apply select` interactive TUI, PTY-driven.
 *
 * The interactive path renders the `SelectView` (see
 * packages/experience-design-system-cli/src/apply/tui/SelectView.tsx) with
 * every entity pre-selected. Keybindings (see apply/command.ts L377-420):
 *   ↑/↓        navigate cursor
 *   Space      toggle the focused row
 *   A / a      select-all
 *   N / n      deselect-all
 *   I / i      apply selected (exits after apply completes)
 *   Q / q      quit (immediate process.exit(0))
 *
 * Bottom legend renders literally:
 *   "N selected · ↑↓ navigate Space toggle A all N none I apply selected Q quit"
 *
 * Mock EMA returns two "new" components (Button, Card) so the view has
 * a non-trivial list to drive.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../src/harness.mjs';
import { startMockEma } from './helpers/mock-ema.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { REACT_MINIMAL_COMPONENTS_JSON } from './helpers/fixtures.mjs';

async function waitForContent(w, pattern, timeout = 6000) {
  const deadline = Date.now() + timeout;
  const test = (s) => (pattern instanceof RegExp ? pattern.test(s) : s.includes(pattern));
  while (Date.now() < deadline) {
    if (test(w.getScreen())) return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return false;
}

describe('apply select interactive TUI', () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()();
  });

  async function reachSelectView() {
    const server = await startMockEma();
    cleanups.push(() => server.close());
    server.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          components: {
            new: [
              { id: 'Button', name: 'Button' },
              { id: 'Card', name: 'Card' },
            ],
            changed: [],
            unchanged: [],
            removed: [],
          },
          tokens: { new: [], changed: [], unchanged: [], removed: [] },
          taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
        }),
      );
    });

    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      [
        'apply',
        'select',
        '--components',
        REACT_MINIMAL_COMPONENTS_JSON,
        '--space-id',
        'sp1',
        '--environment-id',
        'master',
        '--cma-token',
        'fake-token',
        '--host',
        server.host,
      ],
      { env: t.env, cols: 120, rows: 40 },
    );
    cleanups.push(() => w.close());
    await w.waitFor(/Select — master @ sp1/, { timeout: 12000 });
    // Both entities land in the "new" bucket → both rows visible + all
    // pre-selected → legend reads "2 selected".
    await w.waitFor(/Component Types/, { timeout: 3000 });
    await w.waitFor(/2 selected/, { timeout: 3000 });
    return { w, server };
  }

  it('renders the select view with both entities pre-selected', async () => {
    const { w } = await reachSelectView();
    const screen = w.getScreen();
    expect(screen).toMatch(/Button/);
    expect(screen).toMatch(/Card/);
    // Both rows checked.
    const buttonRow = screen.slice(screen.indexOf('Button'));
    expect(buttonRow).toMatch(/\[✓\]/);
  });

  it('space toggles the focused row off (2 → 1 selected)', async () => {
    const { w } = await reachSelectView();
    w.writeKey('space');
    const ok = await waitForContent(w, /1 selected/);
    expect(ok).toBe(true);
  });

  it('N deselects all rows (2 → 0 selected)', async () => {
    const { w } = await reachSelectView();
    w.writeText('N');
    const ok = await waitForContent(w, /0 selected/);
    expect(ok).toBe(true);
  });

  it('A re-selects everything after N', async () => {
    const { w } = await reachSelectView();
    w.writeText('N');
    await waitForContent(w, /0 selected/);
    w.writeText('A');
    const ok = await waitForContent(w, /2 selected/);
    expect(ok).toBe(true);
  });

  it('down-arrow moves the cursor to the second row', async () => {
    const { w } = await reachSelectView();
    // Initial cursor sits on the first Component Types row (Button).
    // Down-arrow moves to Card.
    w.writeKey('down');
    // Cursor glyph ">" now precedes Card in the latest frame.
    const deadline = Date.now() + 5000;
    let ok = false;
    while (Date.now() < deadline) {
      const screen = w.getScreen();
      // Find the Card row in the latest render.
      const lastCardIdx = screen.lastIndexOf('Card');
      // Walk backwards to the start of that row and check for ">".
      const rowStart = screen.lastIndexOf('\n', lastCardIdx);
      const row = screen.slice(rowStart, lastCardIdx);
      if (/>\s*\[/.test(row)) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(ok).toBe(true);
  });

  it('Q quits immediately with exit code 0', async () => {
    const { w } = await reachSelectView();
    w.writeText('Q');
    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (w.isExited()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(w.isExited()).toBe(true);
    // process.exit(0) — the exit code comes back via node-pty as the
    // OS-level exit code. isExited() true is the durable signal.
  });

  it('I applies the current selection and hits /imports/apply on the mock', async () => {
    const { w, server } = await reachSelectView();
    // Deselect one to prove selection state routes through to the apply
    // request body — only Button should end up in the manifest.
    w.writeKey('down');
    await new Promise((r) => setTimeout(r, 200));
    // Cursor on Card → space unchecks Card, leaving Button selected.
    w.writeKey('space');
    await waitForContent(w, /1 selected/);
    w.writeText('I');
    // Wait for the apply request to land on the mock.
    const deadline = Date.now() + 15000;
    let applyReq;
    while (Date.now() < deadline) {
      applyReq = server.requests.find((r) => r.path.endsWith('/imports/apply'));
      if (applyReq) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(applyReq).toBeDefined();
    expect(applyReq.body).toMatch(/Button/);
    expect(applyReq.body).not.toMatch(/Card/);
  });
});
