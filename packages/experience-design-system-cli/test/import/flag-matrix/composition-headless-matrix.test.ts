import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineOptions } from '../../../src/import/orchestrator.js';
import { COMPOSITION_FLAGS } from './flags.js';

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

function findPushCalls(calls: string[][]): string[][] {
  return calls.filter((c) => c.includes('apply') && c.includes('push'));
}

const COMPOSITE_SUBFLAG_OPTS: Partial<PipelineOptions> = {
  compositionMap: '/tmp/map.json',
  compositionAgent: true,
  compositionAgentMode: 'edges',
  compositionRefresh: true,
  generateMap: '/tmp/skeleton.json',
  promptOverrides: ['composition=./p.md'],
};

function stubExecFile(calls: string[][], opts: { pushExit?: number; pushStderr?: string } = {}): void {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: object) => {
    calls.push(args as string[]);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const isPush = args.includes('apply') && args.includes('push');
    setImmediate(() => {
      if (isPush && opts.pushStderr) child.stderr.emit('data', Buffer.from(opts.pushStderr));
      child.emit('close', isPush ? (opts.pushExit ?? 0) : 0);
    });
    return child;
  });
}

describe('flag-matrix: composition flags forwarded through the HEADLESS dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestSessionForCommand.mockReturnValue('extract-session-id');
    mockLoadCDFComponents.mockReturnValue([]);
  });

  // ── composition × mode: --composite reaches the spawned analyze extract ────
  const modeCells: Array<{ name: string; opts: Partial<PipelineOptions>; expectComposite: boolean }> = [
    { name: 'compositionMode composite', opts: { compositionMode: 'composite' }, expectComposite: true },
    { name: 'compositionMode atomic', opts: { compositionMode: 'atomic' }, expectComposite: false },
    { name: 'compositionMode unset', opts: {}, expectComposite: false },
  ];

  it.each(modeCells)(
    '$name → --composite presence on the extract subprocess is correct',
    async ({ opts, expectComposite }) => {
      const { runPipeline } = await import('../../../src/import/orchestrator.js');
      const calls: string[][] = [];
      stubExecFile(calls);
      await runPipeline(baseOpts(opts), () => {}, 'fake-cli-path');
      const extractCall = findExtractCall(calls);
      expect(extractCall).toBeDefined();
      if (expectComposite) {
        expect(extractCall).toContain('--composite');
      } else {
        expect(extractCall).not.toContain('--composite');
      }
    },
  );

  // ── composition sub-flags × composite mode → each sub-flag forwarded ───────
  const subFlagCells: Array<{ flag: string; assert: (joined: string, call: string[]) => void }> = [
    { flag: '--composite', assert: (j) => expect(j).toContain('--composite') },
    { flag: '--composition-map', assert: (j) => expect(j).toContain('--composition-map /tmp/map.json') },
    { flag: '--composition-agent', assert: (j) => expect(j).toContain('--composition-agent') },
    { flag: '--composition-agent-mode', assert: (j) => expect(j).toContain('--composition-agent-mode edges') },
    { flag: '--composition-refresh', assert: (j) => expect(j).toContain('--composition-refresh') },
    { flag: '--generate-map', assert: (j) => expect(j).toContain('--generate-map /tmp/skeleton.json') },
    {
      flag: '--prompt',
      assert: (j, c) => {
        expect(c.filter((a) => a === '--prompt').length).toBe(1);
        expect(j).toContain('--prompt composition=./p.md');
      },
    },
  ];

  it.each(subFlagCells)(
    'composition sub-flag $flag is forwarded to analyze extract under composite mode',
    async ({ assert }) => {
      const { runPipeline } = await import('../../../src/import/orchestrator.js');
      const calls: string[][] = [];
      stubExecFile(calls);
      await runPipeline(
        baseOpts({ compositionMode: 'composite', ...COMPOSITE_SUBFLAG_OPTS }),
        () => {},
        'fake-cli-path',
      );
      const extractCall = findExtractCall(calls);
      expect(extractCall).toBeDefined();
      assert(extractCall!.join(' '), extractCall!);
    },
  );

  it('inventory composition flags are all represented in the sub-flag matrix', () => {
    const covered = new Set(subFlagCells.map((c) => c.flag));
    covered.add('--atomic');
    for (const f of COMPOSITION_FLAGS) {
      expect(covered.has(f), `composition flag ${f} lacks a headless-forwarding cell`).toBe(true);
    }
  });

  // ── composition × headless-trigger flags (the exact miss) ──────────────────
  // Each headless-trigger flag maps onto the PipelineOptions the command
  // dispatcher would produce for that flag; composite forwarding must survive.
  const headlessTriggerCells: Array<{ name: string; opts: Partial<PipelineOptions> }> = [
    { name: '--skip-generate', opts: { skipGenerate: true } },
    { name: '--skip-apply', opts: { skipApply: true } },
    { name: '--yes', opts: { yes: true, skipApply: true } },
    { name: '--dry-run', opts: { dryRun: true, skipApply: true } },
    { name: '--print-prompt (dryRunForward)', opts: { dryRun: true, skipApply: true } },
    { name: '--auto-accept-scope (falls to headless)', opts: { skipApply: true } },
  ];

  it.each(headlessTriggerCells)('composition survives alongside headless-trigger %s', async ({ opts }) => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);
    await runPipeline(
      baseOpts({ compositionMode: 'composite', compositionMap: '/tmp/map.json', ...opts }),
      () => {},
      'fake-cli-path',
    );
    const extractCall = findExtractCall(calls);
    expect(extractCall).toBeDefined();
    expect(extractCall).toContain('--composite');
    expect(extractCall!.join(' ')).toContain('--composition-map /tmp/map.json');
  });

  // ── composition × --no-push / --no-save / --skip-apply forks ───────────────
  // In the headless dispatcher these forks affect apply push, not the extract
  // subprocess. Composition forwarding to extract must be independent of them.
  it('composition forwards under --skip-apply (no push subprocess spawned)', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);
    await runPipeline(baseOpts({ compositionMode: 'composite', skipApply: true }), () => {}, 'fake-cli-path');
    expect(findExtractCall(calls)).toContain('--composite');
    expect(findPushCalls(calls).length).toBe(0);
  });

  it('composition forwards while apply push still runs (skipApply:false)', async () => {
    const { runPipeline } = await import('../../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);
    await runPipeline(
      baseOpts({
        compositionMode: 'composite',
        skipApply: false,
        spaceId: 'sp',
        environmentId: 'master',
        cmaToken: 'tok',
      }),
      () => {},
      'fake-cli-path',
    );
    expect(findExtractCall(calls)).toContain('--composite');
    expect(findPushCalls(calls).length).toBeGreaterThanOrEqual(1);
  });
});
