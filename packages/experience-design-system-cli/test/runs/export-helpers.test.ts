import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { __testing } from '../../src/runs/export-helpers.js';

describe('findCliPath', () => {
  it('resolves to an existing CLI binary at <package-root>/bin/cli.js', () => {
    const cliPath = __testing.findCliPath();
    expect(cliPath.endsWith('/bin/cli.js')).toBe(true);
    expect(existsSync(cliPath)).toBe(true);
  });
});
