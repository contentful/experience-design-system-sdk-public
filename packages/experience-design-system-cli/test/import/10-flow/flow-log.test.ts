import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowState } from '../../../src/tui/import/steps/10-flow/flow/types.js';

// The debug store reads the settings when it is imported, so the test loads a fresh copy under its own EDS_HOME.
describe('the flow debug log', () => {
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

  // The flow state carries the CMA token and the push and preview messages come from the API, which can echo what it was
  // sent. What must hold is that the log, whether the run finishes or is cut short, never contains the token.
  it('never writes the CMA token, not from the state and not from an API message that echoes it', async () => {
    vi.resetModules();
    const store = await import('../../../src/tui/debug-store.js');
    const log = await import('../../../src/tui/import/steps/10-flow/flow/flow-log.js');
    const { EMPTY_PUSH_RESULT } = await import('../../../src/tui/import/steps/10-flow/flow/types.js');
    await vi.waitFor(() => expect(store.currentDebugSessionDir()).toBeDefined());

    const token = 'CFPAT-s3cr3t/abc+def=';
    const echoed = `401 Unauthorized for ${token} (url: /spaces?access_token=${encodeURIComponent(token)})`;
    const state = {
      step: 'path-prompt',
      agent: 'claude',
      spaceId: 'space1',
      environmentId: 'master',
      cmaToken: token,
      host: 'api.contentful.com',
      credentialsSkipped: false,
      generatedCount: 12,
      generatedAcceptedCount: 10,
      tokenCount: 40,
      pushResult: EMPTY_PUSH_RESULT,
      errorStep: '',
      errorMessage: '',
      previewValidationErrors: [],
      previewValidationMissingNames: [],
      componentsPath: '/tmp/out',
      lastRunId: 'run-1',
      serverPreview: {
        components: { new: [{}], changed: [], removed: [] },
        tokens: { new: [], changed: [], removed: [] },
        taxonomies: { new: [], changed: [], removed: [] },
      },
    } as unknown as FlowState;
    const at = (patch: Partial<FlowState>): FlowState => ({ ...state, ...patch });

    const failedPush = at({
      step: 'error',
      errorStep: 'push',
      errorMessage: echoed,
      pushResult: {
        ...EMPTY_PUSH_RESULT,
        componentTypes: { created: 1, updated: 0, removed: 0, failed: 1 },
        failures: [{ entityType: 'componentType', entityId: 'Hero', message: echoed }],
      },
    });
    // The run as it really goes: save the files, preview, wait for the user, push, and the push is rejected.
    let trail = log.openTrail(at({ step: 'path-prompt' }), 0);
    trail = log.advance(trail, at({ step: 'path-prompt' }), at({ step: 'printing' }), 1000);
    trail = log.advance(trail, at({ step: 'printing' }), at({ step: 'previewing' }), 2000);
    trail = log.advance(trail, at({ step: 'previewing' }), at({ step: 'preview-gate' }), 5000);
    trail = log.advance(trail, at({ step: 'preview-gate' }), at({ step: 'pushing' }), 6000);
    const progress = log.flowProgress(trail, 7000);
    trail = log.advance(trail, at({ step: 'pushing' }), failedPush, 8000);

    store.startDebugRun({ ...log.FLOW_RUN });
    await vi.waitFor(async () => {
      await store.finishDebugRun(log.flowFinish(trail, failedPush, 8000));
      expect(await readdir(store.currentDebugSessionDir()!, { recursive: true })).toEqual(
        expect.arrayContaining([expect.stringMatching(/import\/10-publish\/.*\.md$/)]),
      );
    });

    const files = (await readdir(store.currentDebugSessionDir()!, { recursive: true })).filter((n) =>
      n.endsWith('.md'),
    );
    const text = await readFile(join(store.currentDebugSessionDir()!, files[0]!), 'utf8');

    // One log for the whole run, with the cause in it.
    expect(files).toHaveLength(1);
    expect(text).toContain('Push: failed (2s)');
    expect(text).toContain('failed at push: 401 Unauthorized for [redacted]');
    // The credentials are not repeated in this log, and nothing carries the token, finished or cut short.
    expect(text).not.toContain('cma_token');
    for (const written of [text, JSON.stringify(progress)]) {
      expect(written).not.toContain(token);
      expect(written).not.toContain(encodeURIComponent(token));
    }
    expect(JSON.stringify(progress)).toContain('interrupted at Push');
  });
});
