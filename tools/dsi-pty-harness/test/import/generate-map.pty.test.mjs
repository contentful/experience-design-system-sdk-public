/**
 * --generate-map wired into the wizard extract flow.
 *
 * The flag used to write the skeleton then process.exit(0), which aborted the
 * wizard's spawned `analyze extract` before components were stored. It is now
 * write-and-continue: the wizard emits the skeleton as a side effect AND
 * proceeds to the scope-gate. Uses react-composite-cycle (typed-slot
 * composition) so --composite resolves a non-empty edge set without an adapter.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_COMPOSITE_CYCLE } from '../helpers/fixtures.mjs';

describe('experiences import --generate-map (PTY)', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('writes the skeleton AND still reaches the scope-gate (write-and-continue)', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const mapPath = join(t.home, 'composition.map.json');

    const w = await spawnWizard(
      [
        'import',
        '--project',
        REACT_COMPOSITE_CYCLE,
        '--no-push',
        '--no-auto-filter',
        '--composite',
        '--generate-map',
        mapPath,
      ],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());

    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');

    // The wizard did NOT exit early: the scope-gate renders.
    await w.waitFor(/Extraction complete/, { timeout: 30000 });
    expect(w.isExited()).toBe(false);

    // And the skeleton was written as a side effect, in valid interchange form.
    expect(existsSync(mapPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(mapPath, 'utf8'));
    expect(parsed.version).toBe(1);
    expect(typeof parsed.groups).toBe('object');
    // react-composite-cycle has typed-slot composition, so at least one group.
    expect(Object.keys(parsed.groups).length).toBeGreaterThan(0);
  });
});
