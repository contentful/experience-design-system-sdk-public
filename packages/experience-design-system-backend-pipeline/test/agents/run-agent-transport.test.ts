import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from '../../src/agents/services/run-agent.js';
import { createLocalCliAgentInvoker } from '../../src/agents/invoker/create-local-cli-agent-invoker.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

describe('local agent prompt transport', () => {
  const captures: Array<{ args: string[]; input: string; artifactPath?: string; artifactContent?: string }> = [];

  beforeEach(() => {
    vi.stubEnv('EDS_BEDROCK', '0');
    captures.length = 0;
    vi.mocked(spawn)
      .mockReset()
      .mockImplementation((_command, args) => {
        const capture: (typeof captures)[number] = { args: [...(args ?? [])], input: '' };
        captures.push(capture);
        const stdin = new PassThrough();
        stdin.on('data', (chunk: Buffer) => {
          capture.input += chunk.toString();
        });
        stdin.on('finish', () => {
          const match = /^Prompt artifact: (.+)$/m.exec(capture.input || capture.args.at(-1) || '');
          if (match) {
            capture.artifactPath = JSON.parse(match[1]) as string;
            capture.artifactContent = readFileSync(capture.artifactPath, 'utf8');
          }
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

  it.each(['opencode', 'cursor', 'copilot', 'claude'] as const)(
    'passes a large argv prompt to %s without an application byte cap',
    async (agent) => {
      const prompt = '😀'.repeat(100_001);
      const result = await runAgent({ agent, prompt, timeoutMs: 20_000, promptViaStdin: false });
      expect(result.exitCode).toBe(0);
      expect(captures[0].args).toContain(prompt);
      expect(captures[0].input).toBe('');
    },
  );

  it('allows an argv prompt at the former byte limit', async () => {
    const prompt = 'x'.repeat(100_000);
    const result = await runAgent({ agent: 'opencode', prompt, timeoutMs: 20_000 });
    expect(result.exitCode).toBe(0);
    expect(captures[0].args).toContain(prompt);
  });

  it.each([undefined, false])(
    'delivers oversized Codex prompts intact through an artifact (stdin override: %s)',
    async (promptViaStdin) => {
      const prompt = `Task instructions\n${'immutable evidence 😀 '.repeat(200_000)}\nFinal output instructions`;
      const debug = vi.fn();
      const result = await runAgent({
        agent: 'codex',
        model: 'example-model',
        prompt,
        timeoutMs: 20_000,
        promptViaStdin,
        onDebugEvent: debug,
      });
      const capture = captures[0];
      const delivered = promptViaStdin === false ? capture.args.at(-1)! : capture.input;
      expect(result.exitCode).toBe(0);
      expect(delivered.length).toBeLessThan(1_048_576);
      expect(capture.artifactContent).toBe(prompt);
      expect(capture.args).toContain('example-model');
      expect(existsSync(capture.artifactPath!)).toBe(false);
      expect(debug).toHaveBeenCalledWith(
        'run.start',
        expect.objectContaining({ promptLen: prompt.length, promptTransport: 'file' }),
      );
    },
  );

  it.each(['failure', 'abort', 'timeout'] as const)(
    'keeps the oversized prompt available until the child settles after %s',
    async (stop) => {
      const controller = new AbortController();
      let artifactPath = '';
      vi.mocked(spawn).mockImplementationOnce(() => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: vi.fn() });
        let input = '';
        stdin.on('data', (chunk: Buffer) => {
          input += chunk.toString();
        });
        stdin.on('finish', () => {
          artifactPath = JSON.parse(/^Prompt artifact: (.+)$/m.exec(input)![1]) as string;
          expect(existsSync(artifactPath)).toBe(true);
          if (stop === 'abort') controller.abort();
          if (stop === 'timeout') {
            child.kill.mockImplementation(() => {
              expect(existsSync(artifactPath)).toBe(true);
              setImmediate(() => child.emit('close', 0, null));
            });
          } else {
            setImmediate(() => child.emit('close', stop === 'failure' ? 2 : 0, null));
          }
        });
        return child as unknown as ReturnType<typeof spawn>;
      });
      const result = await runAgent({
        agent: 'codex',
        prompt: 'x'.repeat(1_048_577),
        timeoutMs: stop === 'timeout' ? 100 : 20_000,
        signal: controller.signal,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.timedOut).toBe(stop === 'timeout');
      expect(existsSync(artifactPath)).toBe(false);
    },
  );

  it('spawns the agent as a detached process group', async () => {
    await runAgent({ agent: 'claude', prompt: 'small prompt', timeoutMs: 20_000 });
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ detached: true }),
    );
  });

  it('force-settles a timed-out child that ignores SIGTERM', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: vi.fn() });
      vi.mocked(spawn).mockImplementationOnce(() => child as unknown as ReturnType<typeof spawn>);
      const resultPromise = runAgent({ agent: 'claude', prompt: 'prompt', timeoutMs: 1_000 });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
      await expect(resultPromise).resolves.toMatchObject({ exitCode: 1, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
