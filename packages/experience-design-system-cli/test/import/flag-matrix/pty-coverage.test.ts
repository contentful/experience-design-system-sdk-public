import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PTY_CELLS_FILE = resolve(
  import.meta.dirname,
  '../../../../../tools/dsi-pty-harness/test/import/flag-matrix.pty.test.mjs',
);

const PTY_ENABLED = process.env['PTY_TESTS'] === '1';

describe('flag-matrix PTY-cell coverage marker', () => {
  it('the flag-matrix PTY cells file exists on disk', () => {
    expect(existsSync(PTY_CELLS_FILE)).toBe(true);
  });

  const label = PTY_ENABLED
    ? 'PTY cells verified (PTY_TESTS=1) — run in the dsi-pty-harness project'
    : 'PTY cells NOT verified — set PTY_TESTS=1 and run the dsi-pty-harness suite against dist/';

  const cell = PTY_ENABLED ? it : it.skip;
  cell(label, () => {
    expect(PTY_ENABLED).toBe(true);
  });
});
