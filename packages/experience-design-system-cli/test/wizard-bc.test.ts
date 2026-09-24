import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bin = resolve(import.meta.dirname, '../bin/cli.js');

function help(args: string[]): Promise<string> {
  return new Promise((res) => {
    execFile('node', [bin, ...args, '--help'], (_err, stdout) => res(stdout));
  });
}

describe('backwards-compat: standalone subcommand flags', () => {
  it('analyze select flags are stable', async () => {
    const out = await help(['analyze', 'select']);
    for (const flag of [
      '--session',
      '--project-root',
      '--select-all',
      '--select',
      '--deselect',
      '--accept-all',
      '--reject',
      '--patch',
      '--exclude-invalid',
      '--exclude-components',
    ]) {
      expect(out).toContain(flag);
    }
  });

  it('standalone generate command is removed', async () => {
    const out = await help([]);
    expect(out).not.toMatch(/\n\s+generate(?:\s|$)/);
  });

});
