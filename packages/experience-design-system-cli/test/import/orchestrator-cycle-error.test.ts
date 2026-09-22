import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSlotCycleError, extractCycleReport, parseCycleComponentNames } from '../../src/import/orchestrator.js';
import type { PipelineOptions } from '../../src/import/orchestrator.js';

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

vi.mock('../../src/session/db.js', () => ({
  openPipelineDb: vi.fn(() => ({ close: vi.fn() })),
  getOrCreateSession: vi.fn(() => ({ sessionId: 'test-session-id' })),
  createStep: vi.fn(() => 'test-step-id'),
  updateStep: vi.fn(),
  findLatestSessionForCommand: (...args: unknown[]) => mockFindLatestSessionForCommand(...(args as [])),
  loadCDFComponents: (...args: unknown[]) => mockLoadCDFComponents(...(args as [])),
}));

vi.mock('../../src/lib/debug-logger.js', () => ({
  getDebugLogger: vi.fn(() => ({ event: vi.fn() })),
  debugEnvForSubprocess: vi.fn((env: object) => env),
}));

vi.mock('../../src/lib/contentful-urls.js', () => ({
  buildPostPushUrl: vi.fn(() => 'https://test.contentful.com'),
}));

const CYCLE_MARKER = 'manifest:components/slot-cycles';
const CYCLE_STDERR =
  'Error: manifest:components/slot-cycles — 1 slot dependency cycle(s) detected. Push refused.\n' +
  '  Cycle 1: Comp_A → Comp_B → Comp_A\n' +
  "    Fix: remove 'Comp_A' from Comp_B.$slots.children.$allowedComponents";

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

describe('runPipeline cycle error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestSessionForCommand.mockReturnValue(null);
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

describe('parseCycleComponentNames', () => {
  it('parseCycleComponentNames extracts component names from Fix: lines', () => {
    const report = [
      'Error: manifest:components/slot-cycles — 1 slot dependency cycle(s) detected.',
      'Cycle 1: A → B → A',
      "Fix: remove 'B' from A.$slots.children.$allowedComponents",
    ];
    expect(parseCycleComponentNames(report)).toEqual(['B']);
  });

  it('parseCycleComponentNames returns [] when no Fix lines present', () => {
    expect(parseCycleComponentNames(['Error: some other message'])).toEqual([]);
  });
});

describe('runPipeline auto-reject-cycles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestSessionForCommand.mockReturnValue('extract-session-id');
  });

  it('runPipeline with autoRejectCycles:true re-runs analyze select and retries push on cycle', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');

    const calls: string[][] = [];
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: object) => {
      calls.push(args as string[]);
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();

      const isPushCall = args.includes('push');
      const isFirstPush = isPushCall && calls.filter((c) => c.includes('push')).length === 1;

      setImmediate(() => {
        if (isFirstPush) {
          child.stderr.emit('data', Buffer.from(CYCLE_STDERR));
          child.emit('close', 1);
        } else {
          child.stderr.emit('data', Buffer.from(''));
          child.emit('close', 0);
        }
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
      autoRejectCycles: true,
    };

    const result = await runPipeline(opts, () => {}, 'fake-cli-path');

    expect(result.cycleError).toBeUndefined();

    const analyzeCalls = calls.filter((c) => c.includes('select') && c.includes('--exclude-components'));
    expect(analyzeCalls.length).toBeGreaterThanOrEqual(1);
    expect(analyzeCalls[0]?.join(' ')).toContain('Comp_A');

    const pushCalls = calls.filter((c) => c.includes('push'));
    expect(pushCalls.length).toBe(2);
  });

  it('runPipeline with autoRejectCycles:false returns cycleError without retrying', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');

    const calls: string[][] = [];
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: object) => {
      calls.push(args as string[]);
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        if (args.includes('push')) {
          child.stderr.emit('data', Buffer.from(CYCLE_STDERR));
          child.emit('close', 1);
        } else {
          child.emit('close', 0);
        }
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
      autoRejectCycles: false,
    };

    const result = await runPipeline(opts, () => {}, 'fake-cli-path');

    expect(result.cycleError).toBeDefined();

    const analyzeCalls = calls.filter((c) => c.includes('select') && c.includes('--exclude-components'));
    expect(analyzeCalls.length).toBe(0);
  });
});

describe('runPipeline pre-save cycle gate', () => {
  const CYCLIC_ACCEPTED = [
    {
      key: 'Comp_A',
      entry: { $slots: { children: { $allowedComponents: ['Comp_B'] } } },
    },
    {
      key: 'Comp_B',
      entry: { $slots: { children: { $allowedComponents: ['Comp_A'] } } },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestSessionForCommand.mockReturnValue('extract-session-id');
    mockLoadCDFComponents.mockReturnValue([]);
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object) => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => child.emit('close', 0));
      return child;
    });
  });

  it('blocks SAVE (skipApply:true) when accepted components contain a cycle', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');
    mockLoadCDFComponents.mockReturnValue(CYCLIC_ACCEPTED);

    const opts: PipelineOptions = {
      project: '/fake/project',
      out: '/fake/out',
      agent: 'fake-agent',
      skipAnalyze: true,
      skipGenerate: true,
      print: true,
      skipApply: true,
      noCache: false,
      yes: true,
      verbose: false,
    };

    const result = await runPipeline(opts, () => {}, 'fake-cli-path');

    expect(result.cycleError).toBeDefined();
    expect(result.cycleError?.report).toEqual(expect.arrayContaining([expect.stringContaining(CYCLE_MARKER)]));
    // The cycle gate fires BEFORE print, so components.json is never written.
    const printStep = result.steps.find((s) => s.step === 'print components');
    expect(printStep).toBeUndefined();
    const gateStep = result.steps.find((s) => s.step === 'cycle gate');
    expect(gateStep?.status).toBe('failed');
  });

  it('does not block save when accepted components are acyclic', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');
    mockLoadCDFComponents.mockReturnValue([
      { key: 'Comp_A', entry: { $slots: { children: { $allowedComponents: ['Comp_B'] } } } },
      { key: 'Comp_B', entry: { $slots: {} } },
    ]);

    const opts: PipelineOptions = {
      project: '/fake/project',
      out: '/fake/out',
      agent: 'fake-agent',
      skipAnalyze: true,
      skipGenerate: true,
      print: true,
      skipApply: true,
      noCache: false,
      yes: true,
      verbose: false,
    };

    const result = await runPipeline(opts, () => {}, 'fake-cli-path');

    expect(result.cycleError).toBeUndefined();
    expect(result.steps.find((s) => s.step === 'cycle gate')).toBeUndefined();
  });
});

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
