/**
 * Tier 4 (deferred slice) — FieldEditor per-field keystroke coverage.
 *
 * Uses the `pipeline-with-props` fixture variant so `loadCDFComponents`
 * returns non-empty `$properties` for Button/Card/Icon — FieldEditor then
 * renders real per-prop field rows (type/category/required/description)
 * and the picker + toggle + text-entry keystrokes have something to
 * operate on.
 *
 * Reaches final-review via `--modify` (same pattern as 61), then crosses
 * into the FieldEditor panel with Tab. Every test starts from the first
 * prop row of Button (disabled · boolean · state · position=0) — that's
 * FieldEditor's initial focus (`focusLevel: 'prop'`, `propIdx: 0`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { seedRuns } from '../helpers/seed-runs.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from '../helpers/seed-pipeline-db.mjs';

async function waitForContent(w, pattern, timeout = 6000) {
  const deadline = Date.now() + timeout;
  const test = (s) => (pattern instanceof RegExp ? pattern.test(s) : s.includes(pattern));
  while (Date.now() < deadline) {
    if (test(w.getScreen())) return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return false;
}

/**
 * Return the LATEST rendered frame of the FIELDS panel from the
 * append-only PTY buffer. Each frame starts with the `FIELDS [Ctrl+S save
 * · Esc discard]` header, so slice from the last occurrence of that
 * substring to end-of-buffer.
 */
function latestPanel(w) {
  const screen = w.getScreen();
  return screen.slice(screen.lastIndexOf('FIELDS [Ctrl+S save'));
}

/**
 * Return the `type: ...` cell for the `disabled` row in the LATEST frame.
 * Anchored at "disabled" so we don't accidentally pick up `label` or
 * `variant` rows further down.
 */
function disabledTypeCell(w) {
  const panel = latestPanel(w);
  const idx = panel.indexOf('disabled');
  if (idx < 0) return '';
  return panel.slice(idx, idx + 80);
}

describe('FieldEditor per-field keystrokes (with-props fixture)', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  function setup() {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home, { variant: 'with-props' });
    const savePath = join(t.home, 'save');
    mkdirSync(savePath, { recursive: true });
    writeFileSync(join(savePath, 'tokens.json'), '{}\n');
    seedRuns(t.home, [
      {
        id: 'run-fe-1',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath: join(t.home, 'fake-project'),
      },
    ]);
    return { t, dbPath };
  }

  async function reachFirstPropRow() {
    const { t, dbPath } = setup();
    const w = await spawnWizard(['import', '--modify', 'run-fe-1', '--no-push'], {
      env: { HOME: t.home, EDS_PIPELINE_DB_PATH: dbPath },
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());
    await w.waitFor(/FIELDS/, { timeout: 15000 });
    await w.waitFor(/\$properties \(3\)/, { timeout: 5000 });
    // FieldEditor's initial focus is `propIdx: 0` (disabled). Cross into
    // the panel with Tab so keystrokes reach FieldEditor.
    w.writeKey('tab');
    await new Promise((r) => setTimeout(r, 400));
    return w;
  }

  it('Enter on a prop row switches to a field-level mode-label', async () => {
    const w = await reachFirstPropRow();
    w.writeKey('enter');
    const ok = await waitForContent(w, /cycle value/);
    expect(ok).toBe(true);
  });

  it('right-arrow cycles the type picker on the disabled row (boolean → string wraparound)', async () => {
    const w = await reachFirstPropRow();
    w.writeKey('enter');
    // Wait for the active picker on disabled to render.
    const gotActive = await waitForContent(w, /disabled[^\n]*‹boolean›/);
    expect(gotActive).toBe(true);
    w.writeKey('right');
    // CDF_PROPERTY_TYPES is ['string','richtext','media','link','enum','token','boolean'];
    // right-cycle from 'boolean' wraps back to 'string'.
    const deadline = Date.now() + 6000;
    let ok = false;
    while (Date.now() < deadline) {
      const cell = disabledTypeCell(w);
      const m = cell.match(/type:\s*‹([^›]+)›/);
      if (m && m[1] !== 'boolean') {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(ok).toBe(true);
  });

  it('j from the type field cycles to the category picker', async () => {
    const w = await reachFirstPropRow();
    w.writeKey('enter');
    await waitForContent(w, /disabled[^\n]*‹boolean›/);
    w.writeText('j');
    // The active picker caret now brackets the category value on the
    // disabled row (‹state›, ‹content›, or ‹design›).
    const deadline = Date.now() + 6000;
    let ok = false;
    while (Date.now() < deadline) {
      const panel = latestPanel(w);
      const idx = panel.indexOf('disabled');
      const cell = idx < 0 ? '' : panel.slice(idx, idx + 120);
      if (/cat:\s*‹(content|design|state)›/.test(cell)) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(ok).toBe(true);
  });

  it('space toggles the required boolean field on the disabled row', async () => {
    const w = await reachFirstPropRow();
    w.writeKey('enter');
    await waitForContent(w, /disabled[^\n]*‹boolean›/);
    // Cycle from type → category → required.
    w.writeText('j');
    await new Promise((r) => setTimeout(r, 300));
    w.writeText('j');
    // Wait for the required-active mode label.
    const gotReqHint = await waitForContent(w, /Space\/Enter toggle/);
    expect(gotReqHint).toBe(true);
    // Baseline: disabled starts required=false → [ ].
    const panel0 = latestPanel(w);
    const idx0 = panel0.indexOf('disabled');
    const beforeCell = idx0 < 0 ? '' : panel0.slice(idx0, idx0 + 180);
    expect(beforeCell).toMatch(/req:\s*\[\s\]/);
    w.writeKey('space');
    // Wait for the flipped glyph on the disabled row.
    const deadline = Date.now() + 6000;
    let ok = false;
    while (Date.now() < deadline) {
      const panel = latestPanel(w);
      const idx = panel.indexOf('disabled');
      const cell = idx < 0 ? '' : panel.slice(idx, idx + 180);
      if (/req:\s*\[✓\]/.test(cell)) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(ok).toBe(true);
  });

  it('description text-entry: literal chars land in the desc: sub-row', async () => {
    const w = await reachFirstPropRow();
    w.writeKey('enter');
    await waitForContent(w, /disabled[^\n]*‹boolean›/);
    // For a boolean prop, propFields = [type, category, required, default, description].
    // Walk field-by-field with explicit mode-label waits so we don't race
    // Ink's re-render under parallel test load.
    w.writeText('j');
    await waitForContent(w, /cat:\s*‹(content|design|state)›/, 4000);
    w.writeText('j');
    await waitForContent(w, /Space\/Enter toggle/, 4000);
    w.writeText('j');
    await waitForContent(w, /default:\s*‹(false|true|\(unset\))›/, 4000);
    w.writeText('j');
    const inDescMode = await waitForContent(w, /Type to edit/, 8000);
    expect(inDescMode).toBe(true);
    // Type one char at a time; useImmediateInput dispatches per keystroke,
    // and writeText('hello') can deliver the whole string as one input
    // event that the wizard's per-char branch drops after the first char.
    for (const ch of 'hello') {
      w.writeText(ch);
      await new Promise((r) => setTimeout(r, 60));
    }
    const gotText = await waitForContent(w, /hello/, 6000);
    expect(gotText).toBe(true);
  });
});
