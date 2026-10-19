import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  db: { close: vi.fn() },
  openPipelineDb: vi.fn(),
  getOrCreateSession: vi.fn(),
  computeTokenInputHash: vi.fn(),
  lookupCache: vi.fn(),
  copyTokensFromCache: vi.fn(),
  applyTokenToolCalls: vi.fn(),
  storeCache: vi.fn(),
  hashPromptForSkill: vi.fn(),
  bindAnalyticsSessionId: vi.fn(),
  buildPrompt: vi.fn(),
  invokeAgentWithOutput: vi.fn(),
  writeTokensFile: vi.fn(),
}));

vi.mock('../../src/persistence/src/session/repositories/db.js', () => ({
  openPipelineDb: deps.openPipelineDb,
  getOrCreateSession: deps.getOrCreateSession,
  computeTokenInputHash: deps.computeTokenInputHash,
  lookupCache: deps.lookupCache,
  copyTokensFromCache: deps.copyTokensFromCache,
  applyTokenToolCalls: deps.applyTokenToolCalls,
  storeCache: deps.storeCache,
}));
vi.mock('../../src/persistence/src/session/helpers/cache-keys.js', () => ({
  hashPromptForSkill: deps.hashPromptForSkill,
}));
vi.mock('../../src/analytics/index.js', () => ({ bindAnalyticsSessionId: deps.bindAnalyticsSessionId }));
vi.mock('../../src/agents/prompts/build-prompt.js', () => ({ buildPrompt: deps.buildPrompt }));
vi.mock('../../src/agents/services/invoke-agent-with-output.js', () => ({
  invokeAgentWithOutput: deps.invokeAgentWithOutput,
}));
vi.mock('../../src/orchestrators/run-generate-tokens-session/helpers/write-tokens-file.js', () => ({
  writeTokensFile: deps.writeTokensFile,
}));

import {
  runGenerateTokensSession,
  type RunGenerateTokensSessionRequest,
} from '../../src/orchestrators/run-generate-tokens-session/run-generate-tokens-session.js';

describe('runGenerateTokensSession cancellation boundaries', () => {
  let dir: string;
  let rawTokensPath: string;
  const request = (overrides: Partial<RunGenerateTokensSessionRequest> = {}) => ({
    rawTokensPath,
    outDir: join(dir, 'out'),
    agent: 'claude' as const,
    promptOverrides: [],
    noCache: true,
    skillPath: '/test/skill.md',
    ...overrides,
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'token-cancellation-'));
    rawTokensPath = join(dir, 'raw-tokens.json');
    await writeFile(rawTokensPath, '{"color":{"brand":"#123"}}');
    vi.clearAllMocks();
    deps.openPipelineDb.mockReturnValue(deps.db);
    deps.getOrCreateSession.mockReturnValue({ sessionId: 'token-session' });
    deps.computeTokenInputHash.mockReturnValue('token-input-hash');
    deps.lookupCache.mockReturnValue(null);
    deps.hashPromptForSkill.mockResolvedValue('prompt-hash');
    deps.bindAnalyticsSessionId.mockResolvedValue(undefined);
    deps.buildPrompt.mockResolvedValue('prompt');
    deps.writeTokensFile.mockResolvedValue({ tokensPath: join(dir, 'out', 'tokens.json'), tokenCount: 1 });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does no session or child work for a pre-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const onSessionCreated = vi.fn();

    await expect(
      runGenerateTokensSession(request({ signal: controller.signal, onSessionCreated })),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(deps.openPipelineDb).not.toHaveBeenCalled();
    expect(deps.getOrCreateSession).not.toHaveBeenCalled();
    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(deps.invokeAgentWithOutput).not.toHaveBeenCalled();
  });

  it('stops after an awaited session callback observes cancellation', async () => {
    const controller = new AbortController();
    let finishCallback!: () => void;
    const onSessionCreated = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCallback = resolve;
        }),
    );
    const running = runGenerateTokensSession(request({ signal: controller.signal, onSessionCreated }));
    await vi.waitFor(() => expect(onSessionCreated).toHaveBeenCalledOnce());
    controller.abort();
    finishCallback();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.bindAnalyticsSessionId).not.toHaveBeenCalled();
    expect(deps.invokeAgentWithOutput).not.toHaveBeenCalled();
    expect(deps.db.close).toHaveBeenCalledOnce();
  });

  it('does not invoke or write after cancellation while awaiting the prompt hash', async () => {
    const controller = new AbortController();
    let finishHash!: (hash: string) => void;
    deps.hashPromptForSkill.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHash = resolve;
        }),
    );
    const running = runGenerateTokensSession(request({ signal: controller.signal }));
    await vi.waitFor(() => expect(deps.hashPromptForSkill).toHaveBeenCalledOnce());
    controller.abort();
    finishHash('prompt-hash');

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.invokeAgentWithOutput).not.toHaveBeenCalled();
    expect(deps.applyTokenToolCalls).not.toHaveBeenCalled();
    expect(deps.writeTokensFile).not.toHaveBeenCalled();
    expect(deps.db.close).toHaveBeenCalledOnce();
  });

  it('drains a canceled agent result before closing without parsing, caching, or writing valid output', async () => {
    const controller = new AbortController();
    let finishAgent!: (result: unknown) => void;
    deps.invokeAgentWithOutput.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAgent = resolve;
        }),
    );
    const running = runGenerateTokensSession(request({ signal: controller.signal }));
    await vi.waitFor(() => expect(deps.invokeAgentWithOutput).toHaveBeenCalledOnce());
    expect(deps.invokeAgentWithOutput.mock.calls[0]?.[1].signal).toBe(controller.signal);
    controller.abort();
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    finishAgent({
      result: {
        stdout: JSON.stringify({ tool: 'set_token', path: 'color.brand', type: 'color', value: '#123' }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      },
    });
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.applyTokenToolCalls).not.toHaveBeenCalled();
    expect(deps.storeCache).not.toHaveBeenCalled();
    expect(deps.writeTokensFile).not.toHaveBeenCalled();
    expect(deps.db.close).toHaveBeenCalledOnce();
  });

  it('stops a cache-copy branch before starting token-file output after cancellation', async () => {
    const controller = new AbortController();
    deps.lookupCache.mockReturnValue({ sourceSessionId: 'source-session' });
    deps.copyTokensFromCache.mockImplementationOnce(() => controller.abort());
    const onProgress = vi.fn();

    await expect(
      runGenerateTokensSession(request({ noCache: false, signal: controller.signal, onProgress })),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(deps.copyTokensFromCache).toHaveBeenCalledOnce();
    expect(deps.writeTokensFile).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalledWith({ kind: 'cache-hit' });
    expect(deps.db.close).toHaveBeenCalledOnce();
  });
});
