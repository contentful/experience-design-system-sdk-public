import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineOptions } from '../../../src/import/orchestrator.js';

const mockExecFile = vi.fn();
const mockFindLatestSessionForCommand = vi.fn(() => null as string | null);
const mockLoadCDFComponents = vi.fn((): Array<{ key: string; entry: unknown }> => []);

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock('node:fs/promises', async () => {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../../src/session/db.js', () => ({
  openPipelineDb: vi.fn(() => ({ close: vi.fn() })),
  getOrCreateSession: vi.fn(() => ({ sessionId: 'test-session-id' })),
  createStep: vi.fn(() => 'test-step-id'),
  updateStep: vi.fn(),
  findLatestSessionForCommand: (...args: unknown[]) => mockFindLatestSessionForCommand(...(args as [])),
  loadCDFComponents: (...args: unknown[]) => mockLoadCDFComponents(...(args as [])),
}));

vi.mock('../../../src/lib/debug-logger.js', () => ({
  getDebugLogger: vi.fn(() => ({ event: vi.fn() })),
  debugEnvForSubprocess: vi.fn((env: object) => env),
}));

vi.mock('../../../src/lib/contentful-urls.js', () => ({
  buildPostPushUrl: vi.fn(() => 'https://test.contentful.com'),
}));

function baseOpts(overrides: Partial<PipelineOptions>): PipelineOptions {
  return {
    project: '/fake/project',
    out: '/fake/out',
    spaceId: 'test-space',
    environmentId: 'test-env',
    cmaToken: 'test-token',
    agent: 'fake-agent',
    skipAnalyze: true,
    skipGenerate: true,
    print: false,
    skipApply: false,
    noCache: false,
    yes: true,
    verbose: false,
    ...overrides,
  };
}

function stubExecFile(calls: string[][]): void {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: object) => {
    calls.push(args as string[]);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.emit('close', 0);
    });
    return child;
  });
}

describe('flag-matrix: --allow-deletions forwarded through the HEADLESS dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestSessionForCommand.mockReturnValue('extract-session-id');
    mockLoadCDFComponents.mockReturnValue([]);
  });

  // ── --allow-deletions ON → forwarded to the spawned apply push subprocess ────
  it('--allow-deletions ON is forwarded to the spawned apply push subprocess', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);
    await runPipeline(baseOpts({ allowDeletions: true }), () => {}, 'fake-cli-path');
    const pushCall = calls.find((c) => c.includes('apply') && c.includes('push'));
    expect(pushCall).toBeDefined();
    expect(pushCall).toContain('--allow-deletions');
  });

  // ── --allow-deletions OFF → NOT forwarded to the spawned apply push subprocess ──
  it('--allow-deletions OFF (or unset) does not forward the flag to apply push', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);
    await runPipeline(baseOpts({ allowDeletions: false }), () => {}, 'fake-cli-path');
    const pushCall = calls.find((c) => c.includes('apply') && c.includes('push'));
    expect(pushCall).toBeDefined();
    expect(pushCall).not.toContain('--allow-deletions');
  });

  // ── --allow-deletions × --skip-apply fork ──────────────────────────────────
  // When skipApply is true, no push subprocess runs. The flag is a no-op in this fork.
  it('--allow-deletions with --skip-apply does not spawn apply push', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);
    await runPipeline(baseOpts({ allowDeletions: true, skipApply: true }), () => {}, 'fake-cli-path');
    const pushCalls = calls.filter((c) => c.includes('apply') && c.includes('push'));
    expect(pushCalls.length).toBe(0);
  });
});
