import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from '../../src/agents/services/run-agent.js';
import { createLocalCliAgentInvoker } from '../../src/agents/invoker/create-local-cli-agent-invoker.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

describe('local agent prompt transport', () => {
  const captures: Array<{ args: string[]; input: string }> = [];

  beforeEach(() => {
    vi.stubEnv('EDS_BEDROCK', '0');
    captures.length = 0;
    vi.mocked(spawn)
      .mockReset()
      .mockImplementation((_command, args) => {
        const capture = { args: [...(args ?? [])], input: '' };
        captures.push(capture);
        const stdin = new PassThrough();
        stdin.on('data', (chunk: Buffer) => {
          capture.input += chunk.toString();
        });
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: vi.fn() });
        setImmediate(() => {
          stdout.end('raw output');
          stderr.end('diagnostic');
          child.emit('close', 0, null);
        });
        return child as unknown as ReturnType<typeof spawn>;
      });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['claude', 'codex'] as const)('sends a large prompt over stdin by default for %s', async (agent) => {
    const prompt = 'source evidence '.repeat(40_000);
    const streamed: string[] = [];
    const result = await runAgent({ agent, prompt, timeoutMs: 20_000, onOutput: (chunk) => streamed.push(chunk) });
    expect(result).toEqual({ exitCode: 0, stdout: 'raw output', stderr: 'diagnostic', timedOut: false });
    expect(captures[0].args.includes(prompt)).toBe(false);
    expect(captures[0].input === prompt).toBe(true);
    expect(streamed).toEqual(['raw output']);
  });

  it('delivers prompts through the production local invoker without caller transport flags', async () => {
    const prompt = 'source evidence '.repeat(40_000);
    const invoker = createLocalCliAgentInvoker();
    await invoker.invoke({ agent: 'claude', prompt, timeoutMs: 20_000 });
    expect(captures[0].input === prompt).toBe(true);
    expect(captures[0].args.includes(prompt)).toBe(false);
  });

  it('returns before binary resolution and side effects for a pre-aborted invocation', async () => {
    const controller = new AbortController();
    controller.abort();
    const onOutput = vi.fn();
    const onDebugEvent = vi.fn();
    const invoker = createLocalCliAgentInvoker({ onDebugEvent });

    const result = await invoker.invoke({
      agent: 'unsupported' as never,
      prompt: 'prompt',
      timeoutMs: 20_000,
      signal: controller.signal,
      onOutput,
    });

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Agent invocation was cancelled.',
      timedOut: false,
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(onOutput).not.toHaveBeenCalled();
    expect(onDebugEvent).not.toHaveBeenCalled();
  });

  it('forwards an active abort through the local invoker and rejects a zero exit as success', async () => {
    const controller = new AbortController();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: vi.fn() });
    vi.mocked(spawn).mockImplementationOnce(() => child as unknown as ReturnType<typeof spawn>);
    const onOutput = vi.fn();
    const invoker = createLocalCliAgentInvoker();
    const resultPromise = invoker.invoke({
      agent: 'claude',
      prompt: 'prompt',
      timeoutMs: 20_000,
      signal: controller.signal,
      onOutput,
    });

    controller.abort();
    stdout.write('late output');
    stderr.write('retained diagnostic');
    child.emit('close', 0, null);

    await expect(resultPromise).resolves.toEqual({
      exitCode: 1,
      stdout: 'late output',
      stderr: 'retained diagnostic',
      timedOut: false,
    });
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('retains an explicit argv choice for a bounded prompt', async () => {
    await runAgent({ agent: 'claude', prompt: 'small prompt', timeoutMs: 20_000, promptViaStdin: false });
    expect(captures[0]).toEqual({ args: expect.arrayContaining(['small prompt']), input: '' });
  });

  it('retains explicit stdin transport for an existing opted-in caller', async () => {
    await runAgent({ agent: 'opencode', prompt: 'small prompt', timeoutMs: 20_000, promptViaStdin: true });
    expect(captures[0].input).toBe('small prompt');
    expect(captures[0].args).not.toContain('small prompt');
  });

  it.each(['opencode', 'cursor', 'copilot'] as const)(
    'retains default argv delivery for a bounded %s prompt',
    async (agent) => {
      await runAgent({ agent, prompt: 'small prompt', timeoutMs: 20_000 });
      expect(captures[0].args).toContain('small prompt');
      expect(captures[0].input).toBe('');
    },
  );

  it.each(['opencode', 'cursor', 'copilot'] as const)(
    'refuses an oversized argv prompt before spawning %s',
    async (agent) => {
      const result = await runAgent({ agent, prompt: 'x'.repeat(100_001), timeoutMs: 20_000 });
      expect(result).toMatchObject({ exitCode: 1, stdout: '', timedOut: false });
      expect(result.stderr).toContain('command-line argument');
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('applies the argv limit when a caller explicitly disables stdin', async () => {
    const result = await runAgent({
      agent: 'claude',
      prompt: 'x'.repeat(100_001),
      timeoutMs: 20_000,
      promptViaStdin: false,
    });
    expect(result.exitCode).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('allows an argv prompt exactly at the conservative byte limit', async () => {
    const prompt = 'x'.repeat(100_000);
    const result = await runAgent({ agent: 'opencode', prompt, timeoutMs: 20_000 });
    expect(result.exitCode).toBe(0);
    expect(captures[0].args).toContain(prompt);
  });

  it('measures argv size in UTF-8 bytes rather than JavaScript string length', async () => {
    const result = await runAgent({ agent: 'opencode', prompt: '😀'.repeat(25_001), timeoutMs: 20_000 });
    expect(result.exitCode).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });
});
