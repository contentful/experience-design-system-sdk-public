import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
    store.startDebugRun({ flow: 'settings/x', step: '01', menuOption: 'Run', inputs: {} });
    await store.finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'saved' });

    expect(store.currentDebugSessionDir()).toBeUndefined();
    expect(existsSync(join(home, 'debug'))).toBe(false);

    await store.startDebugSessionIn(base);

    expect(store.currentDebugSessionDir()).toMatch(/\.contentful\/\d\d-\d\d-\d{4}-session-1\/debug$/);
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

  it('appends inspectable events without losing concurrent writes and redacts credentials', async () => {
    const store = await load();
    await store.startDebugSessionIn(base);
    const dir = store.currentDebugSessionDir()!;
    expect(typeof store.recordDebugEvent).toBe('function');
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.recordDebugEvent('prop-buckets.select', {
          component: `Field${index}`,
          customPropNames: ['label'],
          cma_token: 'example-token',
        }),
      ),
    );
    const path = join(dir, 'events.jsonl');
    const events = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(12);
    expect(new Set(events.map((event) => event.payload.component)).size).toBe(12);
    expect(
      events.every(
        (event) => event.event === 'prop-buckets.select' && event.payload.cma_token === '[present, 13 chars]',
      ),
    ).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('records nothing without a session or when Debug Mode was disabled after starting it', async () => {
    const store = await load();
    expect(typeof store.recordDebugEvent).toBe('function');
    await store.recordDebugEvent('prop-buckets.select', { component: 'Field' });
    expect(store.currentDebugSessionDir()).toBeUndefined();
    await store.startDebugSessionIn(base);
    const dir = store.currentDebugSessionDir()!;
    await writeFile(join(home, 'config.json'), JSON.stringify({ debugMode: { enabled: false } }));
    await store.recordDebugEvent('prop-buckets.select', { component: 'Field' });
    expect(existsSync(join(dir, 'events.jsonl'))).toBe(false);
  });

  it('does not fail the import when the event log cannot be written', async () => {
    const store = await load();
    await store.startDebugSessionIn(base);
    const dir = store.currentDebugSessionDir()!;
    await rm(dir, { recursive: true });
    await writeFile(dir, 'not a directory');
    expect(typeof store.recordDebugEvent).toBe('function');
    await expect(store.recordDebugEvent('prop-buckets.generate', { component: 'Field' })).resolves.toBeUndefined();
  });

  it('writes nothing while Debug Mode is off', async () => {
    const store = await load({ contentfulBaseDir: base, debugMode: { enabled: false } });
    await store.startDebugSessionIn(base);

    expect(existsSync(join(base, '.contentful'))).toBe(false);
  });
});
