import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const watcher = vi.hoisted(() => ({
  callbacks: [] as Array<(result: { errors: unknown[] }) => void>,
  spawn: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: watcher.spawn }));
vi.mock('esbuild', () => ({
  context: async (options: {
    plugins: Array<{ setup(build: { onEnd(callback: (result: { errors: unknown[] }) => void): void }): void }>;
  }) => {
    options.plugins[0]?.setup({
      onEnd: (callback) => {
        watcher.callbacks.push(callback);
      },
    });
    return { rebuild: async () => {}, watch: async () => {}, dispose: async () => {} };
  },
}));

class Child extends EventEmitter {
  closed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn(() => true);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  watcher.callbacks.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('watch restart cancellation', () => {
  it('does not replace the child when a pending watch restart completes during shutdown', async () => {
    const child = new Child();
    watcher.spawn.mockImplementation(() => child);
    const handlers = new Map<string, () => Promise<void>>();
    const originalOn = process.on.bind(process);
    vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'SIGINT' || event === 'SIGTERM') handlers.set(event, listener as () => Promise<void>);
      else originalOn(event, listener);
      return process;
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../scripts/dev.mjs');
    expect(watcher.spawn).toHaveBeenCalledOnce();

    watcher.callbacks[0]?.({ errors: [] });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    const shutdown = handlers.get('SIGTERM')!();
    child.emit('exit', null);
    child.closed = true;
    child.emit('close', null, 'SIGTERM');
    await shutdown;

    expect(watcher.spawn).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
