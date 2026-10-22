import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({ write: vi.fn<() => Promise<void>>() }));
vi.mock('node:fs/promises', () => ({ mkdir: async () => {}, writeFile: filesystem.write, appendFile: async () => {} }));
vi.mock('node:fs', () => ({ existsSync: () => false, readdirSync: () => [] }));
vi.mock('@contentful/experience-design-system-types/config', () => ({
  readSettings: async () => ({ contentfulBaseDir: '/project' }),
}));
vi.mock('../src/tui/home/version.js', () => ({ readPackageVersion: () => 'version' }));
vi.mock('../src/tui/settings/debug-mode/debug-mode-store.js', () => ({
  readDebugModeSetting: async () => ({ enabled: true }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('import debug shutdown cancellation', () => {
  it('uses the first terminal signal and waits for one debug finalization across both signals', async () => {
    const handlers = new Map<string, () => void>();
    const originalOnce = process.once.bind(process);
    vi.spyOn(process, 'once').mockImplementation((event, listener) => {
      if (typeof event === 'string' && ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].includes(event))
        handlers.set(event, listener as () => void);
      else originalOnce(event, listener);
      return process;
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    let finishWrite!: () => void;
    filesystem.write.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const store = await import('../src/tui/debug-store.js');
    await store.startDebugSessionIn('/project');
    store.startDebugRun({ flow: 'import', step: 'prepare', menuOption: 'Run', inputs: {} });
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      handlers.get('SIGINT')!();
      await vi.waitFor(() => expect(filesystem.write).toHaveBeenCalledOnce());
      handlers.get('SIGTERM')!();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(exit).not.toHaveBeenCalled();
      finishWrite();
      await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(130));
      expect(filesystem.write).toHaveBeenCalledOnce();
    } finally {
      finishWrite?.();
    }
  });
});
