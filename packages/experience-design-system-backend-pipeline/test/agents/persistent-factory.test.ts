import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalCliAgentInvoker } from '../../src/agents/invoker/create-local-cli-agent-invoker.js';
import { runAgent } from '../../src/agents/services/run-agent.js';
import { createCodexAppServerRuntime } from '../../src/agents/services/codex-app-server/runtime.js';
vi.mock('../../src/agents/services/run-agent.js', () => ({
  runAgent: vi.fn(async () => ({ exitCode: 0, stdout: 'legacy', stderr: '', timedOut: false })),
}));
vi.mock('../../src/agents/services/codex-app-server/runtime.js', () => ({
  createCodexAppServerRuntime: vi.fn(() => ({
    invoke: vi.fn(async () => ({ exitCode: 0, stdout: 'persistent', stderr: '', timedOut: false })),
    close: vi.fn(async () => {}),
    admit: vi.fn(),
    createHandoff: vi.fn(),
  })),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe('explicit persistent factory routing', () => {
  it('keeps default invocation and all non-Codex/Bedrock routes unchanged', async () => {
    const input = { agent: 'codex' as const, prompt: 'test', timeoutMs: 0 };
    expect((await createLocalCliAgentInvoker().invoke(input)).stdout).toBe('legacy');
    const invoker = createLocalCliAgentInvoker({ codexAppServer: { operationId: 'op', timeoutMs: 0 } });
    expect((await invoker.invoke({ ...input, bedrock: true })).stdout).toBe('legacy');
    expect((await invoker.invoke({ ...input, agent: 'claude' })).stdout).toBe('legacy');
    vi.stubEnv('EDS_BEDROCK', '1');
    expect((await invoker.invoke(input)).stdout).toBe('legacy');
    expect(runAgent).toHaveBeenCalledTimes(4);
    expect(runAgent).toHaveBeenLastCalledWith(expect.objectContaining({ preserveConversation: true }));
  });
  it('opts in once and exposes operation close/admission/handoff without changing model', async () => {
    const settings = { operationId: 'operation', timeoutMs: 0 };
    const invoker = createLocalCliAgentInvoker({ codexAppServer: settings });
    const input = { agent: 'codex' as const, model: 'existing-model', prompt: 'test', timeoutMs: 0 };
    expect((await invoker.invoke(input)).stdout).toBe('persistent');
    expect(createCodexAppServerRuntime).toHaveBeenCalledWith(settings, undefined);
    const runtime = vi.mocked(createCodexAppServerRuntime).mock.results.at(-1)!.value;
    expect(runtime.invoke).toHaveBeenCalledWith(input);
    expect(invoker).toHaveProperty('close');
    expect(invoker).toHaveProperty('admit');
    expect(invoker).toHaveProperty('createHandoff');
  });
});
