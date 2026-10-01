import { describe, expect, it, vi } from 'vitest';
import { executeGenerationOrchestrator } from '../../src/orchestrator/execute-generation-orchestrator.js';
import type { GenerationOrchestratorRequest } from '../../src/orchestrator/execute-generation-orchestrator.js';

describe('executeGenerationOrchestrator', () => {
  it('builds a prompt from promptOptions and passes it to the invoker', async () => {
    const fakeResult = {
      exitCode: 0,
      stdout: 'tool output',
      stderr: '',
      timedOut: false,
    };
    const fakeInvoke = vi.fn().mockResolvedValue(fakeResult);
    const fakeInvoker = { invoke: fakeInvoke, checkAuth: vi.fn() };

    const request: GenerationOrchestratorRequest = {
      agent: 'claude',
      timeoutMs: 5000,
      promptOptions: {
        skill: 'components',
        mode: 'autonomous',
        outDir: '/tmp',
        skillContentOverride: 'STUB_SKILL_CONTENT',
      },
      invoker: fakeInvoker,
    };

    const result = await executeGenerationOrchestrator(request);

    expect(result).toEqual(fakeResult);
    expect(fakeInvoke).toHaveBeenCalledOnce();
    const invokeArg = fakeInvoke.mock.calls[0][0];
    expect(invokeArg.agent).toBe('claude');
    expect(invokeArg.timeoutMs).toBe(5000);
    expect(typeof invokeArg.prompt).toBe('string');
    expect(invokeArg.prompt).toContain('STUB_SKILL_CONTENT');
  });

  it('forwards model, bedrock, and onOutput to the invoker', async () => {
    const fakeInvoke = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    });
    const onOutput = vi.fn();

    const request: GenerationOrchestratorRequest = {
      agent: 'codex',
      model: 'gpt-5',
      bedrock: true,
      timeoutMs: 10000,
      onOutput,
      promptOptions: {
        skill: 'tokens',
        mode: 'autonomous',
        outDir: '/tmp',
        skillContentOverride: 'TOKEN_SKILL',
      },
      invoker: { invoke: fakeInvoke, checkAuth: vi.fn() },
    };

    await executeGenerationOrchestrator(request);

    const invokeArg = fakeInvoke.mock.calls[0][0];
    expect(invokeArg.model).toBe('gpt-5');
    expect(invokeArg.bedrock).toBe(true);
    expect(invokeArg.onOutput).toBe(onOutput);
  });
});
