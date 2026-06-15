import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { runBuild } from '../src/program.js';

/**
 * P2.5 regression: when `pnpm` (or any spawn target) errors before exit
 * (e.g. ENOENT — not on PATH), the previous implementation swallowed
 * `err.message` and returned exit code 1 with no context. Users saw a
 * generic non-zero exit and had no idea what failed. The fix surfaces
 * `err.message` to stderr before resolving.
 *
 * runBuild is the spawn-shaped helper extracted from registerBuildCommand
 * for testability — takes a spawnFn dependency and returns a Promise of
 * { exitCode, errorMessage? } so the test can drive the error / exit
 * paths without invoking real pnpm.
 */

type FakeChild = EventEmitter;

function fakeSpawn(emitError?: Error, exitCode?: number): { fn: () => FakeChild; child: FakeChild } {
  const child = new EventEmitter() as FakeChild;
  return {
    child,
    fn: () => {
      // emit on next tick so the caller can wire .on() handlers first
      setImmediate(() => {
        if (emitError) child.emit('error', emitError);
        if (exitCode !== undefined) child.emit('exit', exitCode);
      });
      return child;
    },
  };
}

describe('runBuild — spawn error surfacing (P2.5)', () => {
  it('returns exitCode 1 and the error message when spawn emits an error', async () => {
    const err = new Error('spawn pnpm ENOENT');
    const { fn } = fakeSpawn(err);
    const stderrWrites: string[] = [];

    const result = await runBuild({
      spawnFn: fn,
      stderrWrite: (s) => {
        stderrWrites.push(s);
      },
    });

    expect(result.exitCode).toBe(1);
    expect(stderrWrites.join('')).toContain('spawn pnpm ENOENT');
  });

  it('returns the actual exit code when spawn exits cleanly', async () => {
    const { fn } = fakeSpawn(undefined, 0);
    const result = await runBuild({ spawnFn: fn, stderrWrite: () => {} });
    expect(result.exitCode).toBe(0);
  });

  it('returns the actual exit code when spawn exits with a non-zero code', async () => {
    const { fn } = fakeSpawn(undefined, 2);
    const result = await runBuild({ spawnFn: fn, stderrWrite: () => {} });
    expect(result.exitCode).toBe(2);
  });

  it('does not double-resolve when error and exit both fire (settles on first)', async () => {
    // Some systems emit error THEN exit. The promise must only settle once.
    const child = new EventEmitter() as FakeChild;
    const stderrWrites: string[] = [];
    const spawnFn = (): FakeChild => {
      setImmediate(() => {
        child.emit('error', new Error('boom'));
        child.emit('exit', 99);
      });
      return child;
    };

    const result = await runBuild({
      spawnFn,
      stderrWrite: (s) => {
        stderrWrites.push(s);
      },
    });

    // Whichever fired first wins. 'boom' fires first, so exitCode is 1.
    expect(result.exitCode).toBe(1);
    expect(stderrWrites.join('')).toContain('boom');
  });

  it('handles a non-Error value passed to error (e.g. a string)', async () => {
    // Defensive: child_process always emits Error, but be safe.
    const child = new EventEmitter() as FakeChild;
    const stderrWrites: string[] = [];
    const spawnFn = (): FakeChild => {
      setImmediate(() => child.emit('error', 'some string error' as unknown as Error));
      return child;
    };

    const result = await runBuild({
      spawnFn,
      stderrWrite: (s) => {
        stderrWrites.push(s);
      },
    });

    expect(result.exitCode).toBe(1);
    expect(stderrWrites.join('')).toContain('some string error');
  });
});
