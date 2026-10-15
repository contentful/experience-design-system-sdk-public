import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The debug store reads the settings and may create its session folder when it is imported, so every test loads a
// fresh copy under its own EDS_HOME.
type DebugStore = typeof import('../src/tui/debug-store.js');

describe('the debug store', () => {
  let home: string;
  let base: string;

  const load = async (settings: Record<string, unknown> = {}): Promise<DebugStore> => {
    await writeFile(join(home, 'config.json'), JSON.stringify({ debugMode: { enabled: true }, ...settings }));
    vi.resetModules();
    return import('../src/tui/debug-store.js');
  };

  const logFiles = async (dir: string): Promise<string[]> =>
    existsSync(dir) ? (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.md')) : [];

  const logRun = async (store: DebugStore, dir: string): Promise<void> => {
    store.startDebugRun({ flow: 'settings/x', step: '01', menuOption: 'Run', inputs: {} });
    await vi.waitFor(async () => {
      await store.finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'saved' });
      expect(await logFiles(dir)).not.toEqual([]);
    });
  };

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'eds-home-'));
    base = await mkdtemp(join(tmpdir(), 'eds-base-'));
    process.env['EDS_HOME'] = home;
  });

  afterEach(async () => {
    // each fresh copy of the store registers its own crash handlers on the process
    for (const event of ['uncaughtException', 'unhandledRejection', 'SIGINT'] as const)
      process.removeAllListeners(event);
    delete process.env['EDS_HOME'];
    await rm(home, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  });

  it('starts a numbered session in the configured base directory at boot and logs there', async () => {
    const store = await load({ contentfulBaseDir: base });
    await vi.waitFor(() => expect(store.currentDebugSessionDir()).toBeDefined());

    await logRun(store, join(base, '.contentful'));

    expect(store.currentDebugSessionDir()).toMatch(/\.contentful\/\d\d-\d\d-\d{4}-session-1\/debug$/);
    expect(existsSync(join(home, 'debug'))).toBe(false);
  });

  it('numbers the next session after the ones already there', async () => {
    const first = await load({ contentfulBaseDir: base });
    await vi.waitFor(() => expect(first.currentDebugSessionDir()).toBeDefined());

    const second = await load({ contentfulBaseDir: base });
    await vi.waitFor(() => expect(second.currentDebugSessionDir()).toBeDefined());

    expect(second.currentDebugSessionDir()).toMatch(/-session-2\/debug$/);
  });

  it('creates nothing until the import starts when no base directory is set', async () => {
    const store = await load();
    store.startDebugRun({ flow: 'settings/x', step: '01', menuOption: 'Run', inputs: {} });
    await store.finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'saved' });

    expect(store.currentDebugSessionDir()).toBeUndefined();
    expect(existsSync(join(home, 'debug'))).toBe(false);

    await store.startDebugSessionIn(base);

    expect(store.currentDebugSessionDir()).toMatch(/\.contentful\/\d\d-\d\d-\d{4}-session-1\/debug$/);
    await logRun(store, join(base, '.contentful'));
  });

  it('keeps the configured base directory when the import starts in another project', async () => {
    const store = await load({ contentfulBaseDir: base });
    await vi.waitFor(() => expect(store.currentDebugSessionDir()).toBeDefined());
    const before = store.currentDebugSessionDir();

    await store.startDebugSessionIn(join(base, 'elsewhere'));

    expect(store.currentDebugSessionDir()).toBe(before);
  });

  it('starts the session as soon as the base directory is saved, without a restart', async () => {
    const store = await load();
    expect(store.currentDebugSessionDir()).toBeUndefined();

    await store.startDebugSessionIn(base);

    expect(existsSync(store.currentDebugSessionDir()!)).toBe(true);
    await logRun(store, join(base, '.contentful'));
  });

  it('writes nothing while Debug Mode is off', async () => {
    const store = await load({ contentfulBaseDir: base, debugMode: { enabled: false } });
    await store.startDebugSessionIn(base);

    expect(existsSync(join(base, '.contentful'))).toBe(false);
  });
});
