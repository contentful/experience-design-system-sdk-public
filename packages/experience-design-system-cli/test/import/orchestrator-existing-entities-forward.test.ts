import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineOptions } from '../../src/import/orchestrator.js';

const mockExecFile = vi.fn();
const mockFindLatestSessionForCommand = vi.fn(() => 'extract-session-id' as string | null);
const mockLoadCDFComponents = vi.fn((): Array<{ key: string; entry: unknown }> => [{ key: 'k', entry: {} }]);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockFetchExistingContentfulEntities = vi.fn().mockResolvedValue({ components: [], tokens: [] });

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...(args as [])),
  writeFile: (...args: unknown[]) => mockWriteFile(...(args as [])),
}));

vi.mock('../../src/session/db.js', () => ({
  openPipelineDb: vi.fn(() => ({ close: vi.fn() })),
  getOrCreateSession: vi.fn(() => ({ sessionId: 'test-session-id' })),
  createStep: vi.fn(() => 'test-step-id'),
  updateStep: vi.fn(),
  findLatestSessionForCommand: (...args: unknown[]) => mockFindLatestSessionForCommand(...(args as [])),
  loadCDFComponents: (...args: unknown[]) => mockLoadCDFComponents(...(args as [])),
  storeDTCGTokens: vi.fn(),
}));

vi.mock('../../src/helpers/fetch-existing-contentful-entities.js', () => ({
  fetchExistingContentfulEntitiesFromContentful: (...args: unknown[]) =>
    mockFetchExistingContentfulEntities(...(args as [])),
}));

vi.mock('../../src/helpers/build-contentful-management-client.js', () => ({
  buildContentfulManagementClient: vi.fn(() => ({}) as unknown),
}));

vi.mock('../../src/lib/debug-logger.js', () => ({
  getDebugLogger: vi.fn(() => ({ event: vi.fn() })),
  debugEnvForSubprocess: vi.fn((env: object) => env),
}));

vi.mock('../../src/lib/contentful-urls.js', () => ({
  buildPostPushUrl: vi.fn(() => 'https://test.contentful.com'),
}));

function baseOptsWithCredentials(): PipelineOptions {
  return {
    project: '/fake/project',
    out: '/fake/out',
    spaceId: 'sp',
    environmentId: 'env',
    cmaToken: 'tok',
    agent: 'fake-agent',
    skipAnalyze: false,
    skipGenerate: false,
    print: false,
    skipApply: true,
    noCache: false,
    yes: true,
    verbose: false,
  };
}

function stubExecFile(calls: string[][]): void {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: object) => {
    calls.push(args as string[]);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      // The orchestrator's select-step stderr parser expects an "Accepted: N" line.
      child.stderr.emit('data', Buffer.from('Accepted: 0\n'));
      child.emit('close', 0);
    });
    return child;
  });
}

describe('runPipeline forwards --existing-entities-path after fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestSessionForCommand.mockReturnValue('extract-session-id');
    mockLoadCDFComponents.mockReturnValue([{ key: 'k', entry: {} }]);
    mockFetchExistingContentfulEntities.mockResolvedValue({ components: [], tokens: [] });
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('forwards --existing-entities-path to analyze select-agent, generate components, and map tokens', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);

    await runPipeline(baseOptsWithCredentials(), () => {}, 'fake-cli-path');

    const expectedPath = '/fake/out/.existing-entities.json';

    const selectAgentCall = calls.find((c) => c.includes('select-agent'));
    expect(selectAgentCall, 'analyze select-agent subprocess was invoked').toBeDefined();
    expect(selectAgentCall!.join(' ')).toContain(`--existing-entities-path ${expectedPath}`);

    const generateCall = calls.find((c) => c.includes('generate') && c.includes('components'));
    expect(generateCall, 'generate components subprocess was invoked').toBeDefined();
    expect(generateCall!.join(' ')).toContain(`--existing-entities-path ${expectedPath}`);

    const mapTokensCall = calls.find((c) => c.includes('map') && c.includes('tokens'));
    expect(mapTokensCall, 'map tokens subprocess was invoked').toBeDefined();
    expect(mapTokensCall!.join(' ')).toContain(`--existing-entities-path ${expectedPath}`);
  });

  it('does NOT forward --existing-entities-path when CMA credentials are absent', async () => {
    const { runPipeline } = await import('../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);

    const opts = baseOptsWithCredentials();
    delete opts.cmaToken;
    await runPipeline(opts, () => {}, 'fake-cli-path');

    for (const call of calls) {
      expect(call.join(' ')).not.toContain('--existing-entities-path');
    }
  });

  it('does NOT forward --existing-entities-path when the fetch fails (no file written)', async () => {
    mockFetchExistingContentfulEntities.mockRejectedValueOnce(new Error('CMA offline'));

    const { runPipeline } = await import('../../src/import/orchestrator.js');
    const calls: string[][] = [];
    stubExecFile(calls);

    await runPipeline(baseOptsWithCredentials(), () => {}, 'fake-cli-path');

    for (const call of calls) {
      expect(call.join(' ')).not.toContain('--existing-entities-path');
    }
  });
});
