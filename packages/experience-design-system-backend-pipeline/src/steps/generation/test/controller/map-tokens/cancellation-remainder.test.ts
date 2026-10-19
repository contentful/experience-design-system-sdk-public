import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { lookupCache } from '../../../../../persistence/src/session/repositories/db.js';

const database = vi.hoisted(() => ({
  db: { close: vi.fn(), exec: vi.fn(), prepare: vi.fn() },
  openPipelineDb: vi.fn(),
  findLatestSessionForCommand: vi.fn(),
  loadTokenLeaves: vi.fn(),
  replaceRawTokenNamePaths: vi.fn(),
  loadRawDefaults: vi.fn(),
  loadRawTokenNamePathRows: vi.fn(),
  loadCDFComponents: vi.fn(),
  loadDTCGTokens: vi.fn(),
  loadComponentSourceRefs: vi.fn(),
  createStep: vi.fn(() => 1),
  updateStep: vi.fn(),
  bindAnalyticsSessionId: vi.fn(),
  computeMapTokensInputHash: vi.fn(() => 'input-hash'),
  copyMapTokensFromCache: vi.fn(() => 1),
  lookupCache: vi.fn<typeof lookupCache>(() => null),
  storeCache: vi.fn(),
  parseMapTokenPropToolCalls: vi.fn(() => ({ calls: [], warnings: [] })),
  buildPrompt: vi.fn(async () => 'prompt'),
  invoke: vi.fn(),
  binaryExists: vi.fn(async () => true),
}));

vi.mock('../../../../../persistence/src/session/repositories/db.js', () => ({
  openPipelineDb: database.openPipelineDb,
  findLatestSessionForCommand: database.findLatestSessionForCommand,
  loadTokenLeaves: database.loadTokenLeaves,
  replaceRawTokenNamePaths: database.replaceRawTokenNamePaths,
  loadRawDefaults: database.loadRawDefaults,
  loadRawTokenNamePathRows: database.loadRawTokenNamePathRows,
  loadCDFComponents: database.loadCDFComponents,
  loadDTCGTokens: database.loadDTCGTokens,
  loadComponentSourceRefs: database.loadComponentSourceRefs,
  computeMapTokensInputHash: database.computeMapTokensInputHash,
  copyMapTokensFromCache: database.copyMapTokensFromCache,
  createStep: database.createStep,
  lookupCache: database.lookupCache,
  storeCache: database.storeCache,
  updateStep: database.updateStep,
}));
vi.mock('../../../../../analytics/index.js', () => ({ bindAnalyticsSessionId: database.bindAnalyticsSessionId }));
vi.mock('../../../../../agents/parsers/parse-map-token-prop-tool-calls.js', () => ({
  parseMapTokenPropToolCalls: database.parseMapTokenPropToolCalls,
}));
vi.mock('../../../../../agents/prompts/build-prompt.js', () => ({ buildPrompt: database.buildPrompt }));
vi.mock('../../../../../agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({ invoke: database.invoke }),
}));
vi.mock('../../../../../agents/helpers/resolution/binary-exists.js', () => ({ binaryExists: database.binaryExists }));

import { runMapTokens } from '../../../src/controller/map-tokens/run-map-tokens.js';

beforeEach(() => {
  vi.clearAllMocks();
  database.db.prepare.mockReturnValue({ all: vi.fn(() => []) });
  database.openPipelineDb.mockReturnValue(database.db);
  database.findLatestSessionForCommand.mockReturnValue('session-1');
  database.loadTokenLeaves.mockReturnValue([{ path: 'color.brand', kind: 'color' }]);
  database.loadRawDefaults.mockReturnValue([]);
  database.loadRawTokenNamePathRows.mockReturnValue([]);
  database.loadCDFComponents.mockReturnValue([
    {
      key: 'Button',
      entry: { $type: 'component', $properties: { color: { $type: 'token', $category: 'design' } } },
    },
  ]);
  database.loadDTCGTokens.mockReturnValue({ groups: [], tokens: [{ path: 'color.brand', value: '#000' }] });
  database.loadComponentSourceRefs.mockResolvedValue([]);
});

describe('cancellation remainder — token mapping', () => {
  it.each([
    ['manual', { tokenMapInline: { '#000': 'color.brand' }, skipAgent: true }],
    ['default', { skipAgent: true }],
    ['nothing-to-map', { skipAgent: true }],
    ['print-prompt', { printPrompt: true }],
    ['skip', { skipAgent: true }],
    ['cache', { cache: true }],
  ])('pre-abort prevents %s branch mutations and success', async (_branch, overrides) => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runMapTokens({
        sessionId: 'session-1',
        agent: 'claude',
        skillContentOverride: 'test prompt',
        ...overrides,
        signal: controller.signal,
      } as never),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(database.replaceRawTokenNamePaths).not.toHaveBeenCalled();
    expect(database.createStep).not.toHaveBeenCalled();
    expect(database.openPipelineDb).not.toHaveBeenCalled();
    expect(database.db.close).not.toHaveBeenCalled();
    expect(database.storeCache).not.toHaveBeenCalled();
  });

  it('keeps the existing skip branch for a live request', async () => {
    await expect(
      runMapTokens({ sessionId: 'session-1', agent: 'claude', skipAgent: true } as never),
    ).resolves.toMatchObject({ type: 'skipped' });
    expect(database.replaceRawTokenNamePaths).toHaveBeenCalledOnce();
  });

  it('retains successful print, no-op, default, and cache branches for live requests', async () => {
    await expect(
      runMapTokens({
        sessionId: 'session-1',
        agent: 'claude',
        printPrompt: true,
        skillContentOverride: 'prompt',
      } as never),
    ).resolves.toMatchObject({ type: 'printed-prompt', prompt: 'prompt' });

    database.loadCDFComponents.mockReturnValueOnce([
      { key: 'Button', entry: { $type: 'component', $properties: { label: { $type: 'text', $category: 'content' } } } },
    ]);
    await expect(runMapTokens({ sessionId: 'session-1', agent: 'claude' } as never)).resolves.toMatchObject({
      type: 'nothing-to-map',
    });

    database.loadRawDefaults.mockReturnValueOnce([{ default_reference: '#000', cdf_token_kind: 'color' }]);
    await expect(
      runMapTokens({ sessionId: 'session-1', agent: 'claude', skipAgent: true } as never),
    ).resolves.toMatchObject({
      type: 'skipped',
    });
    expect(database.replaceRawTokenNamePaths).toHaveBeenCalled();

    database.lookupCache.mockReturnValueOnce({
      inputHash: 'input-hash',
      entityType: 'token_mapping',
      entityId: '__map_tokens__',
      sourceSessionId: 'source-session',
      humanEdited: false,
      promptHash: 'prompt-hash',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    await expect(
      runMapTokens({ sessionId: 'session-1', agent: 'claude', cache: true } as never),
    ).resolves.toMatchObject({
      type: 'cached',
      applied: 1,
    });
    expect(database.copyMapTokensFromCache).toHaveBeenCalledWith(database.db, 'source-session', 'session-1');
  });

  it('drains an active mapping invocation and does not parse, apply, cache, or complete canceled valid output', async () => {
    const controller = new AbortController();
    let finishInvocation!: (result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }) => void;
    database.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInvocation = resolve;
        }),
    );
    const running = runMapTokens({
      sessionId: 'session-1',
      agent: 'claude',
      cache: true,
      skillContentOverride: 'test prompt',
      signal: controller.signal,
    } as never);
    await vi.waitFor(() => expect(database.invoke).toHaveBeenCalledOnce());
    controller.abort();
    finishInvocation({
      stdout: JSON.stringify({ tool: 'map_token_prop', raw_name: '#000', token_path: 'color.brand' }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(database.parseMapTokenPropToolCalls).not.toHaveBeenCalled();
    expect(database.storeCache).not.toHaveBeenCalled();
    expect(database.updateStep).not.toHaveBeenCalled();
    expect(database.db.close).toHaveBeenCalledOnce();
  });
});
