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

  it('generate components flags are stable', async () => {
    const out = await help(['generate', 'components']);
    for (const flag of [
      '--session',
      '--tokens',
      '--token-map',
      '--agent',
      '--model',
      '--verbose',
      '--dry-run',
      '--no-cache',
    ]) {
      expect(out).toContain(flag);
    }
  });

  it('apply push flags are stable', async () => {
    const out = await help(['apply', 'push']);
    for (const flag of [
      '--components',
      '--tokens',
      '--session',
      '--space-id',
      '--environment-id',
      '--cma-token',
      '--host',
      '--yes',
      '--verbose',
      '--force',
      '--dry-run',
    ]) {
      expect(out).toContain(flag);
    }
  });
});
