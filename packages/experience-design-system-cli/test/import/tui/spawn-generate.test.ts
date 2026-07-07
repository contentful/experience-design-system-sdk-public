import { describe, expect, it } from 'vitest';
import { spawnGenerateChild } from '../../../src/import/tui/spawn-generate.js';

/**
 * Pre-fetch generation refactor: the wizard needs to spawn `generate components`
 * from the scope-gate confirm callback (before credentials) and await the
 * result later (after credentials validate). These tests pin the surface area
 * of the extracted `spawnGenerateChild` helper.
 *
 * Each test drives a tiny `node -e` subprocess in lieu of the real CLI so we
 * exercise the spawn-and-listen machinery without booting the full wizard.
 */
describe('spawnGenerateChild', () => {
  it('returns a child + donePromise that resolves with exitCode/stdout/stderr on clean exit', async () => {
    const { child, donePromise } = spawnGenerateChild({
      command: 'node',
      args: ['-e', 'process.stdout.write("session=abc-123\\n"); process.stderr.write("done\\n")'],
    });
    expect(child.pid).toBeGreaterThan(0);
    const result = await donePromise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('session=abc-123');
    expect(result.stderr).toContain('done');
  });

  it('donePromise resolves with non-zero exitCode when the child exits with an error', async () => {
    const { donePromise } = spawnGenerateChild({
      command: 'node',
      args: ['-e', 'process.stderr.write("boom\\n"); process.exit(2)'],
    });
    const result = await donePromise;
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('boom');
  });

  it('killing the child before exit resolves the promise with a SIGTERM signal', async () => {
    const { child, donePromise } = spawnGenerateChild({
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    // Give it a tick to actually spawn before SIGTERM.
    await new Promise((r) => setTimeout(r, 50));
    child.kill('SIGTERM');
    const result = await donePromise;
    expect(result.signal).toBe('SIGTERM');
  });

  it('invokes onStderr with raw chunks so callers can stream progress lines', async () => {
    const chunks: string[] = [];
    const { donePromise } = spawnGenerateChild({
      command: 'node',
      args: ['-e', 'process.stderr.write("progress=generate:1/3:Foo\\n")'],
      onStderr: (chunk) => chunks.push(chunk),
    });
    await donePromise;
    expect(chunks.join('')).toContain('progress=generate:1/3:Foo');
  });
});
