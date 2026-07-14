import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSlotCycleError, extractCycleReport } from '../../src/import/orchestrator.js';
import type { PipelineOptions } from '../../src/import/orchestrator.js';

// ─── Mocks for runPipeline integration test ──────────────────────────────────

const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock('node:fs/promises', async () => {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../src/session/db.js', () => ({
  openPipelineDb: vi.fn(() => ({ close: vi.fn() })),
  getOrCreateSession: vi.fn(() => ({ sessionId: 'test-session-id' })),
  createStep: vi.fn(() => 'test-step-id'),
  updateStep: vi.fn(),
  findLatestSessionForCommand: vi.fn(() => null),
  loadCDFComponents: vi.fn(() => []),
}));

vi.mock('../../src/lib/debug-logger.js', () => ({
  getDebugLogger: vi.fn(() => ({ event: vi.fn() })),
  debugEnvForSubprocess: vi.fn((env: object) => env),
}));

vi.mock('../../src/lib/contentful-urls.js', () => ({
  buildPostPushUrl: vi.fn(() => 'https://test.contentful.com'),
}));

// ─── Constant mirrored from command.ts (verified against formatSlotCycleReport) ─
const CYCLE_MARKER = 'manifest:components/slot-cycles';
const CYCLE_STDERR =
  'Error: manifest:components/slot-cycles — 1 slot dependency cycle(s) detected. Push refused.\n' +
  '  Cycle 1: Comp_A → Comp_B → Comp_A\n' +
  "    Fix: remove 'Comp_A' from Comp_B.$slots.children.$allowedComponents";

// ─── Tests 1–3: pure unit tests of isSlotCycleError ─────────────────────────

describe('isSlotCycleError', () => {
  it('returns true when stderr contains the cycle error marker', () => {
    expect(
      isSlotCycleError({
        exitCode: 1,
        stderr: CYCLE_STDERR,
      }),
    ).toBe(true);
  });

  it('returns false for unrelated stderr', () => {
    expect(
      isSlotCycleError({
        exitCode: 1,
        stderr: 'Error: something completely different went wrong',
      }),
    ).toBe(false);
  });

  it('returns false when exitCode is 0 even with cycle marker in stderr', () => {
    expect(
      isSlotCycleError({
        exitCode: 0,
        stderr: CYCLE_STDERR,
      }),
    ).toBe(false);
  });
});

// ─── Test 4: runPipeline integration ────────────────────────────────────────

describe('runPipeline cycle error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a cycleError result when apply push exits with slot-cycle stderr', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object) => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stderr.emit('data', Buffer.from(CYCLE_STDERR));
        child.emit('close', 1);
      });
      return child;
    });

    const opts: PipelineOptions = {
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
    };

    const result = await runPipeline(opts, () => {}, 'fake-cli-path');

    expect(result.cycleError).toBeDefined();
    expect(result.cycleError?.report).toEqual(expect.arrayContaining([expect.stringContaining(CYCLE_MARKER)]));

    const pushStep = result.steps.find((s) => s.step === 'apply push');
    expect(pushStep).toBeDefined();
    expect(pushStep?.status).toBe('failed');
    expect(pushStep?.error).toContain(CYCLE_MARKER);
  });
});

// ─── extractCycleReport unit tests ──────────────────────────────────────────

describe('extractCycleReport', () => {
  it('returns non-empty lines from cycle stderr', () => {
    const lines = extractCycleReport(CYCLE_STDERR);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes(CYCLE_MARKER))).toBe(true);
  });

  it('returns empty array for empty string', () => {
    expect(extractCycleReport('')).toEqual([]);
  });
});
