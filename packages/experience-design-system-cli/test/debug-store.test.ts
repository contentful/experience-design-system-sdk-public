import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('creates nothing until the import starts when no base directory is set', async () => {
    const store = await load();
    // The first import step finishes before the project, and so the session folder, is known.
    store.startDebugRun({ flow: 'import/preflight', step: '00', menuOption: 'Preflight', inputs: {} });
    await new Promise((resolve) => setTimeout(resolve, 100)); // the run registers once Debug Mode has been read
    await store.finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'saved' });

    expect(store.currentDebugSessionDir()).toBeUndefined();
    expect(existsSync(join(home, 'debug'))).toBe(false);

    await store.startDebugSessionIn(base);
    await store.startDebugSessionIn(base);

    expect(store.currentDebugSessionDir()).toMatch(/\.contentful\/\d\d-\d\d-\d{4}-session-1\/debug$/);
    // The early log is written when the session starts, once, and not again by the next start.
    expect(await logFiles(join(base, '.contentful'))).toEqual([
      expect.stringMatching(/debug\/import\/preflight\/\d\d-\d\d-\d{4}-preflight-attempt-1\.md$/),
    ]);
    await logRun(store, join(base, '.contentful'));
  });

  it('gives every import run its own numbered folder in the session', async () => {
    const store = await load({ contentfulBaseDir: base });
    await vi.waitFor(() => expect(store.currentDebugSessionDir()).toBeDefined());

    const first = await store.startImportRun(base);
    const second = await store.startImportRun(base);

    expect(first).toMatch(/\.contentful\/\d\d-\d\d-\d{4}-session-1\/dsi-import-1$/);
    expect(second).toMatch(/\/dsi-import-2$/);
    expect(existsSync(first) && existsSync(second)).toBe(true);
  });

  it('writes nothing while Debug Mode is off', async () => {
    const store = await load({ contentfulBaseDir: base, debugMode: { enabled: false } });
    await store.startDebugSessionIn(base);

    expect(existsSync(join(base, '.contentful'))).toBe(false);
  });

  // A step that ends in the same moment it starts (a fast failure) must be logged as itself. If its run were registered
  // late, its finish would be dropped and the next step's finish would land on it, mixing two steps into one log.
  it('keeps a step that finishes straight after it starts, and does not mix it into the next one', async () => {
    const store = await load({ contentfulBaseDir: base });
    await vi.waitFor(() => expect(store.currentDebugSessionDir()).toBeDefined());

    store.startDebugRun({ flow: 'import/first', step: '01', menuOption: 'First', inputs: { marker: 'first-input' } });
    await store.finishDebugRun({ outputs: { marker: 'first-output' }, status: 'success', exitMethod: 'saved' });
    store.startDebugRun({
      flow: 'import/second',
      step: '02',
      menuOption: 'Second',
      inputs: { marker: 'second-input' },
    });
    await store.finishDebugRun({ outputs: { marker: 'second-output' }, status: 'success', exitMethod: 'saved' });

    const dir = store.currentDebugSessionDir()!;
    const read = async (flow: string): Promise<string> => {
      const file = (await readdir(join(dir, flow), { recursive: true })).find((name) => name.endsWith('.md'))!;
      return readFile(join(dir, flow, file), 'utf8');
    };
    const first = await read('import/first');
    const second = await read('import/second');

    expect(first).toContain('first-input');
    expect(first).toContain('first-output');
    expect(second).toContain('second-input');
    expect(second).toContain('second-output');
    expect(first).not.toContain('second-');
    expect(second).not.toContain('first-');
  });
});
