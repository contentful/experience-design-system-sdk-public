import { mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readZip } from './helpers/read-zip.js';

// The debug store reads the settings when it is imported, so each test loads a fresh copy under its own EDS_HOME.
describe('the support bundle', () => {
  let home: string;
  let base: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'eds-home-'));
    base = await mkdtemp(join(tmpdir(), 'eds-base-'));
    process.env['EDS_HOME'] = home;
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({ debugMode: { enabled: true }, contentfulBaseDir: base }),
    );
  });

  afterEach(async () => {
    // each fresh copy of the store registers its own crash handlers on the process
    for (const event of ['uncaughtException', 'unhandledRejection', 'SIGINT', 'SIGTERM', 'SIGHUP'] as const)
      process.removeAllListeners(event);
    delete process.env['EDS_HOME'];
    await rm(home, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  });

  async function load() {
    vi.resetModules();
    const store = await import('../src/tui/debug-store.js');
    const bundle = await import('../src/tui/support-bundle.js');
    await vi.waitFor(() => expect(store.currentSessionDir()).toBeDefined());
    return { store, bundle };
  }

  // The zip is made the moment an error screen appears, and the log of the step that failed is only just being written.
  it('includes the log of the step that has just failed, even while it is still being written', async () => {
    const { store, bundle } = await load();
    store.startDebugRun({ flow: 'import/extraction', step: '06-extraction', menuOption: 'Extraction', inputs: {} });
    void store.finishDebugRun({
      outputs: { error: 'the agent is not signed in' },
      status: 'error',
      exitMethod: 'discarded',
    });

    const result = await bundle.bundleDebugLogs();

    if (result.status !== 'created') throw new Error(`expected a zip, got ${result.status}`);
    const entries = readZip(readFileSync(result.path));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toMatch(/^import\/06-extraction\/.*extraction.*\.md$/);
    expect(entries[0]!.data.toString()).toContain('the agent is not signed in');
  });

  it('puts the zip beside the debug folder, so making it again does not zip the zip', async () => {
    const { store, bundle } = await load();
    store.startDebugRun({ flow: 'import/welcome', step: '01-welcome', menuOption: 'Welcome', inputs: {} });
    await store.finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'saved' });

    const first = await bundle.bundleDebugLogs();
    const second = await bundle.bundleDebugLogs();

    if (first.status !== 'created' || second.status !== 'created') throw new Error('expected two zips');
    expect(first.path).toBe(second.path);
    expect(first.path).toBe(join(store.currentSessionDir()!, `${basename(store.currentSessionDir()!)}-debug-logs.zip`));
    expect(readZip(readFileSync(second.path))).toHaveLength(1);
  });

  it('has nothing to send when no logs were written, which is what Debug Mode being off leaves', async () => {
    const { bundle } = await load();

    expect(await bundle.bundleDebugLogs()).toEqual({ status: 'no-logs' });
  });

  it('reports that it could not make the zip, without throwing, and says where the logs are', async () => {
    const { store, bundle } = await load();
    store.startDebugRun({ flow: 'import/welcome', step: '01-welcome', menuOption: 'Welcome', inputs: {} });
    await store.finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'saved' });
    // A folder where the zip should go, so writing it fails.
    mkdirSync(join(store.currentSessionDir()!, `${basename(store.currentSessionDir()!)}-debug-logs.zip`));

    const result = await bundle.bundleDebugLogs();

    expect(result).toEqual({ status: 'failed', folder: store.currentDebugSessionDir() });
  });

  it('tells the user what to do in each case: where the file is, how to get logs, or which folder to zip', async () => {
    const { bundle } = await load();

    expect(bundle.supportInstruction({ status: 'created', path: '/s/session-1-debug-logs.zip', files: 3 })).toMatch(
      /\/s\/session-1-debug-logs\.zip[\s\S]*Contentful support/,
    );
    expect(bundle.supportInstruction({ status: 'no-logs' })).toMatch(/Debug Mode[\s\S]*Contentful support/);
    expect(bundle.supportInstruction({ status: 'failed', folder: '/s/debug' })).toMatch(
      /\/s\/debug[\s\S]*Contentful support/,
    );
  });
});
