import { describe, expect, it } from 'vitest';
import { spawnGenerateChild } from '../../../src/import/tui/spawn-generate.js';

/**
 * Spec: cancellation never leaves an orphaned subprocess in the generate
 * child ref. We can't easily inspect a wizard-internal ref from outside, but
 * we can pin the underlying invariant: after SIGTERM, the child's exit code /
 * signal is reported AND `child.killed` flips to true before we resolve.
 */
describe('spawnGenerateChild — cancellation hygiene', () => {
  it('SIGTERM on the child resolves with signal=SIGTERM and child.killed === true', async () => {
    const { child, donePromise } = spawnGenerateChild({
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(child.killed).toBe(false);
    child.kill('SIGTERM');
    const result = await donePromise;
    expect(result.signal).toBe('SIGTERM');
    expect(child.killed).toBe(true);
  });

  it('does not throw if SIGTERM is sent twice in a row', async () => {
    const { child, donePromise } = spawnGenerateChild({
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    await new Promise((r) => setTimeout(r, 50));
    child.kill('SIGTERM');
    // Second SIGTERM on an already-killed child is a no-op (returns false).
    expect(() => child.kill('SIGTERM')).not.toThrow();
    const result = await donePromise;
    expect(result.signal).toBe('SIGTERM');
  });
});
