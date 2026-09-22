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

const CYCLE_STDERR =
  'Error: manifest:components/slot-cycles — 1 slot dependency cycle(s) detected. Push refused.\n' +
  '  Cycle 1: Comp_A → Comp_B → Comp_A\n' +
  "    Fix: remove 'Comp_A' from Comp_B.$slots.children.$allowedComponents";

function cycleAwareExecFile(calls: string[][]): void {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: object) => {
    calls.push(args as string[]);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const isPush = args.includes('push');
    const isFirstPush = isPush && calls.filter((c) => c.includes('push')).length === 1;
    setImmediate(() => {
      if (isFirstPush) {
        child.stderr.emit('data', Buffer.from(CYCLE_STDERR));
        child.emit('close', 1);
      } else {
        child.emit('close', 0);
      }
    });
    return child;
  });
}

function cycleOpts(overrides: Partial<PipelineOptions>): PipelineOptions {
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

describe('flag-matrix: --auto-reject-cycles behavior in the HEADLESS dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestSessionForCommand.mockReturnValue('extract-session-id');
    mockLoadCDFComponents.mockReturnValue([]);
  });

  // ── --auto-reject-cycles × --no-push fork ──────────────────────────────────
  // --no-push in the headless dispatcher maps to skipApply:true, so no push
  // subprocess runs and the cycle retry path never triggers. Assert the flag
  // is a harmless no-op on that fork (no exclude-components reject call).
  it('--auto-reject-cycles with a no-push fork (skipApply:true) does not run the push retry', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    cycleAwareExecFile(calls);
    const result = await runPipeline(cycleOpts({ autoRejectCycles: true, skipApply: true }), () => {}, 'fake-cli-path');
    expect(result.cycleError).toBeUndefined();
    expect(calls.filter((c) => c.includes('--exclude-components')).length).toBe(0);
  });

  // ── --auto-reject-cycles ON → excludes cycle members and retries push ──────
  it('--auto-reject-cycles ON excludes cycle participants and retries the push', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    cycleAwareExecFile(calls);
    const result = await runPipeline(cycleOpts({ autoRejectCycles: true }), () => {}, 'fake-cli-path');
    expect(result.cycleError).toBeUndefined();
    const rejectCalls = calls.filter((c) => c.includes('--exclude-components'));
    expect(rejectCalls.length).toBeGreaterThanOrEqual(1);
    expect(rejectCalls[0]?.join(' ')).toContain('Comp_A');
    expect(calls.filter((c) => c.includes('push')).length).toBe(2);
  });

  // ── --auto-reject-cycles OFF → surfaces cycleError, no retry ───────────────
  it('--auto-reject-cycles OFF surfaces cycleError without retrying', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    cycleAwareExecFile(calls);
    const result = await runPipeline(cycleOpts({ autoRejectCycles: false }), () => {}, 'fake-cli-path');
    expect(result.cycleError).toBeDefined();
    expect(calls.filter((c) => c.includes('--exclude-components')).length).toBe(0);
  });

  // ── --auto-reject-cycles × --composite: composition still forwarded ────────
  it('--auto-reject-cycles combined with --composite still forwards --composite to extract', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    // Fresh analyze this time so the extract subprocess is actually spawned.
    cycleAwareExecFile(calls);
    const result = await runPipeline(
      cycleOpts({ autoRejectCycles: true, skipAnalyze: false, compositionMode: 'composite' }),
      () => {},
      'fake-cli-path',
    );
    expect(result.cycleError).toBeUndefined();
    const extractCall = calls.find((c) => c.includes('analyze') && c.includes('extract'));
    expect(extractCall).toBeDefined();
    expect(extractCall).toContain('--composite');
  });
});
