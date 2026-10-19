import { describe, expect, it, vi } from 'vitest';
import { executeGenerationOrchestrator } from '../../src/orchestrator/execute-generation-orchestrator.js';
import * as promptService from '../../src/services/prompts/build-prompt.js';
import type { GenerationOrchestratorRequest } from '../../src/orchestrator/execute-generation-orchestrator.js';

describe('executeGenerationOrchestrator', () => {
  it('builds a prompt from promptOptions and passes it to the invoker', async () => {
    const fakeResult = { exitCode: 0, stdout: 'tool output', stderr: '', timedOut: false };
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
    const fakeInvoke = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    const onOutput = vi.fn();
    const controller = new AbortController();

    const request: GenerationOrchestratorRequest = {
      agent: 'codex',
      model: 'gpt-5',
      bedrock: true,
      timeoutMs: 10000,
      onOutput,
      signal: controller.signal,
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
    expect(invokeArg.signal).toBe(controller.signal);
  });

  it('does not invoke after cancellation during asynchronous prompt construction', async () => {
    let releasePrompt!: () => void;
    const pendingPrompt = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const originalBuildPrompt = promptService.buildPrompt;
    const buildPromptSpy = vi.spyOn(promptService, 'buildPrompt').mockImplementationOnce(async (options) => {
      await pendingPrompt;
      return originalBuildPrompt(options);
    });
    const controller = new AbortController();
    const fakeInvoke = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    const request: GenerationOrchestratorRequest = {
      agent: 'claude',
      timeoutMs: 5000,
      signal: controller.signal,
      promptOptions: {
        skill: 'components',
        mode: 'autonomous',
        outDir: '/tmp',
        skillContentOverride: 'STUB_SKILL_CONTENT',
      },
      invoker: { invoke: fakeInvoke, checkAuth: vi.fn() },
    };

    const resultPromise = executeGenerationOrchestrator(request);
    controller.abort();
    releasePrompt();

    await expect(resultPromise).resolves.toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Agent invocation was cancelled.',
      timedOut: false,
    });
    expect(buildPromptSpy).toHaveBeenCalledOnce();
    expect(fakeInvoke).not.toHaveBeenCalled();
    buildPromptSpy.mockRestore();
  });
});
