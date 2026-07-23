import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  findLatestSessionForCommand: (...args: unknown[]) => mockFindLatestSessionForCommand(...args),
  loadCDFComponents: (...args: unknown[]) => mockLoadCDFComponents(...(args as [])),
}));

vi.mock('../../src/lib/debug-logger.js', () => ({
  getDebugLogger: vi.fn(() => ({ event: vi.fn() })),
  debugEnvForSubprocess: vi.fn((env: object) => env),
}));

vi.mock('../../src/lib/contentful-urls.js', () => ({
  buildPostPushUrl: vi.fn(() => 'https://test.contentful.com'),
}));

function baseOpts(overrides: Partial<PipelineOptions>): PipelineOptions {
  return {
    project: '/fake/project',
    out: '/fake/out',
    agent: 'fake-agent',
    skipAnalyze: false,
    skipGenerate: true,
    print: false,
    skipApply: true,
    noCache: false,
    yes: true,
    verbose: false,
    ...overrides,
  };
}

function findExtractCall(calls: string[][]): string[] | undefined {
  return calls.find((c) => c.includes('analyze') && c.includes('extract'));
}

describe('runPipeline composition mode forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestSessionForCommand.mockReturnValue('extract-session-id');
    mockLoadCDFComponents.mockReturnValue([]);
  });

  function stubExecFile(calls: string[][]): void {
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: object) => {
      calls.push(args as string[]);
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => child.emit('close', 0));
      return child;
    });
  }

  it('forwards --composite to the spawned analyze extract when compositionMode is composite', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);

    await runPipeline(baseOpts({ compositionMode: 'composite' }), () => {}, 'fake-cli-path');

    const extractCall = findExtractCall(calls);
    expect(extractCall).toBeDefined();
    expect(extractCall).toContain('--composite');
  });

  it('forwards composition sub-flags when set alongside composite mode', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);

    await runPipeline(
      baseOpts({
        compositionMode: 'composite',
        compositionMap: '/tmp/map.json',
        compositionAgent: true,
        compositionAgentMode: 'edges',
        compositionRefresh: true,
        generateMap: '/tmp/skeleton.json',
        promptOverrides: ['composition=./p.md', 'grouping=./g.md'],
      }),
      () => {},
      'fake-cli-path',
    );

    const extractCall = findExtractCall(calls);
    expect(extractCall).toBeDefined();
    const joined = extractCall!.join(' ');
    expect(joined).toContain('--composite');
    expect(joined).toContain('--composition-map /tmp/map.json');
    expect(joined).toContain('--composition-agent');
    expect(joined).toContain('--composition-agent-mode edges');
    expect(joined).toContain('--composition-refresh');
    expect(joined).toContain('--generate-map /tmp/skeleton.json');
    expect(extractCall!.filter((a) => a === '--prompt').length).toBe(2);
    expect(joined).toContain('--prompt composition=./p.md');
    expect(joined).toContain('--prompt grouping=./g.md');
    expect(joined).toContain('--agent fake-agent');
  });

  it('does not forward --composite when compositionMode is atomic', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);

    await runPipeline(
      baseOpts({
        compositionMode: 'atomic',
        compositionMap: '/tmp/map.json',
        compositionAgent: true,
        generateMap: '/tmp/skeleton.json',
      }),
      () => {},
      'fake-cli-path',
    );

    const extractCall = findExtractCall(calls);
    expect(extractCall).toBeDefined();
    expect(extractCall).not.toContain('--composite');
    expect(extractCall).not.toContain('--composition-map');
    expect(extractCall).not.toContain('--generate-map');
  });

  it('does not forward --composite when compositionMode is unset', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);

    await runPipeline(baseOpts({}), () => {}, 'fake-cli-path');

    const extractCall = findExtractCall(calls);
    expect(extractCall).toBeDefined();
    expect(extractCall).not.toContain('--composite');
  });
});
