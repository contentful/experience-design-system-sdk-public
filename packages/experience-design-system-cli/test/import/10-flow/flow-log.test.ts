import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowState } from '../../../src/tui/import/steps/10-flow/flow/types.js';

// The debug store reads the settings when it is imported, so the test loads a fresh copy under its own EDS_HOME.
describe('the flow debug logs', () => {
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
    for (const event of ['uncaughtException', 'unhandledRejection', 'SIGINT'] as const)
      process.removeAllListeners(event);
    delete process.env['EDS_HOME'];
    await rm(home, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  });

  // The flow state carries the CMA token and the push and preview messages come from the API, which can echo what it was
  // sent. What must hold is that no flow log, whichever step and however it ended, contains the token.
  it('never writes the CMA token, not from the state and not from an API message that echoes it', async () => {
    vi.resetModules();
    const store = await import('../../../src/tui/debug-store.js');
    const { flowStepInputs, flowStepOutputs, flowStepRun } =
      await import('../../../src/tui/import/steps/10-flow/flow/flow-log.js');
    const { EMPTY_PUSH_RESULT } = await import('../../../src/tui/import/steps/10-flow/flow/types.js');
    await vi.waitFor(() => expect(store.currentDebugSessionDir()).toBeDefined());

    const token = 'CFPAT-s3cr3t/abc+def=';
    const echoed = `401 Unauthorized for ${token} (url: /spaces?access_token=${encodeURIComponent(token)})`;
    const base_ = {
      step: 'final-review',
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
      errorAllowCredentialRetry: false,
      errorAllowBreakingChangeAcknowledgment: false,
      previewValidationErrors: [],
      previewValidationMissingNames: [],
      componentsPath: '',
      lastRunId: null,
      finalizeErrorBanner: null,
      outDir: '/tmp/out',
    } as unknown as FlowState;
    const at = (patch: Partial<FlowState>): FlowState => ({ ...base_, ...patch });

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
    const badPreview = at({
      step: 'preview-validation-error',
      previewValidationErrors: [{ componentName: 'Hero', path: '/props/a', message: echoed }],
    });
    const banner = at({ step: 'previewing', finalizeErrorBanner: echoed });

    // Each case is a step that started in `from` and ended in `to`; the log it writes is what is checked.
    const cases: Array<{ from: FlowState; to: FlowState | undefined }> = [
      { from: at({ step: 'pushing' }), to: failedPush },
      { from: failedPush, to: undefined },
      { from: badPreview, to: at({ step: 'final-review' }) },
      { from: at({ step: 'final-review' }), to: banner },
    ];
    for (const { from, to } of cases) {
      store.startDebugRun({ ...flowStepRun(from.step), inputs: flowStepInputs(from) });
      const before = (await readdir(store.currentDebugSessionDir()!, { recursive: true })).filter((n) =>
        n.endsWith('.md'),
      ).length;
      await vi.waitFor(async () => {
        await store.finishDebugRun(flowStepOutputs(from, to));
        const now = (await readdir(store.currentDebugSessionDir()!, { recursive: true })).filter((n) =>
          n.endsWith('.md'),
        ).length;
        expect(now).toBe(before + 1);
      });
    }

    const files = (await readdir(store.currentDebugSessionDir()!, { recursive: true })).filter((n) =>
      n.endsWith('.md'),
    );
    const logs = await Promise.all(files.map((file) => readFile(join(store.currentDebugSessionDir()!, file), 'utf8')));
    const all = logs.join('\n');

    expect(files).toHaveLength(4);
    expect(all).not.toContain(token);
    expect(all).not.toContain(encodeURIComponent(token));
    // The token is still reported as set (and how long), and the rejections are still in the logs.
    expect(all).toContain(`[present, ${token.length} chars]`);
    expect(all).toContain('401 Unauthorized for [redacted]');
  });
});
