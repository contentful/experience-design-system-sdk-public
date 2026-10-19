import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenerationEndpoint } from '../src/controller/create-generation-endpoint.js';
import { buildPrompt } from '../src/services/prompts/build-prompt.js';
import { runAgent } from '../src/services/agent/run-agent.js';
import type { GenerationEndpointRequest } from '../src/types/contract.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

describe('generation agent prompt transport', () => {
  const captures: Array<{ args: string[]; input: string; env?: NodeJS.ProcessEnv }> = [];

  beforeEach(() => {
    vi.stubEnv('EDS_BEDROCK', '0');
    captures.length = 0;
    vi.mocked(spawn)
      .mockReset()
      .mockImplementation((_command, args, options) => {
        const capture = {
          args: [...(args ?? [])],
          input: '',
          env: (options as { env?: NodeJS.ProcessEnv } | undefined)?.env,
        };
        captures.push(capture);
        const stdin = new PassThrough();
        stdin.on('data', (chunk: Buffer) => {
          capture.input += chunk.toString();
        });
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: vi.fn() });
        setImmediate(() => {
          stdout.end('runner stdout');
          stderr.end('runner stderr');
          setImmediate(() => child.emit('close', 0, null));
        });
        return child as unknown as ReturnType<typeof spawn>;
      });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['claude', 'codex'] as const)('defaults %s prompts to stdin', async (agent) => {
    const prompt = 'default transport prompt';
    const result = await runAgent({ agent, prompt, timeoutMs: 20_000 });

    expect(result).toEqual({ exitCode: 0, stdout: 'runner stdout', stderr: 'runner stderr', timedOut: false });
    expect(captures[0].input === prompt).toBe(true);
    expect(captures[0].args.some((arg) => arg === prompt)).toBe(false);
  });

  it.each(['opencode', 'cursor', 'copilot'] as const)('%s retains argv as its default transport', async (agent) => {
    const prompt = 'small prompt';
    await runAgent({ agent, prompt, timeoutMs: 20_000 });

    expect(captures[0].args.some((arg) => arg === prompt)).toBe(true);
    expect(captures[0].input).toBe('');
  });

  it('preserves an explicit argv override for Claude', async () => {
    await runAgent({ agent: 'claude', prompt: 'small prompt', timeoutMs: 20_000, promptViaStdin: false });

    expect(captures[0].args).toContain('small prompt');
    expect(captures[0].input).toBe('');
  });

  it('preserves an explicit stdin override for OpenCode', async () => {
    await runAgent({ agent: 'opencode', prompt: 'small prompt', timeoutMs: 20_000, promptViaStdin: true });

    expect(captures[0].args).not.toContain('small prompt');
    expect(captures[0].input).toBe('small prompt');
  });

  it('accepts argv prompts exactly at the UTF-8 byte limit', async () => {
    const prompt = 'x'.repeat(100_000);
    const result = await runAgent({ agent: 'opencode', prompt, timeoutMs: 20_000 });

    expect(result.exitCode).toBe(0);
    expect(captures[0].args.some((arg) => arg === prompt)).toBe(true);
  });

  it.each([
    ['an ASCII prompt above the limit', 'x'.repeat(100_001)],
    ['a multibyte prompt above the limit', '😀'.repeat(25_001)],
  ])('rejects %s before spawning or reporting output', async (_case, prompt) => {
    const onOutput = vi.fn();
    const result = await runAgent({ agent: 'opencode', prompt, timeoutMs: 20_000, onOutput });

    expect(result).toMatchObject({ exitCode: 1, stdout: '', timedOut: false });
    expect(result.stderr.includes('100000-byte safety limit')).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('rejects an oversized explicitly argv-delivered Claude prompt before side effects', async () => {
    const onOutput = vi.fn();
    const result = await runAgent({
      agent: 'claude',
      prompt: 'x'.repeat(100_001),
      timeoutMs: 20_000,
      promptViaStdin: false,
      onOutput,
    });

    expect(result).toMatchObject({ exitCode: 1, stdout: '', timedOut: false });
    expect(spawn).not.toHaveBeenCalled();
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('uses stdin through the declared endpoint and preserves model, Bedrock, output, and result behavior', async () => {
    const request: GenerationEndpointRequest = {
      agent: 'claude',
      model: 'opus',
      bedrock: true,
      timeoutMs: 20_000,
      promptOptions: {
        skill: 'components',
        mode: 'autonomous',
        outDir: '/tmp',
        skillContentOverride: 'large prompt '.repeat(12_500),
      },
      onOutput: vi.fn(),
    };
    const expectedPrompt = await buildPrompt(request.promptOptions);
    const onOutput = request.onOutput as ReturnType<typeof vi.fn>;
    const onDebugEvent = vi.fn();
    const endpoint = createGenerationEndpoint({ onDebugEvent });

    const result = await endpoint.run(request);

    expect(result).toEqual({ exitCode: 0, stdout: 'runner stdout', stderr: 'runner stderr', timedOut: false });
    expect(captures[0].input === expectedPrompt).toBe(true);
    expect(captures[0].args.some((arg) => arg === expectedPrompt)).toBe(false);
    expect(captures[0].args).toContain('--model');
    expect(captures[0].args).toContain('opus');
    expect(captures[0].env?.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(onOutput).toHaveBeenCalledWith('runner stdout');
    expect(onDebugEvent).toHaveBeenCalledWith(
      'run.start',
      expect.objectContaining({ agent: 'claude', model: 'opus', bedrock: true, promptLen: expectedPrompt.length }),
    );
    expect(onDebugEvent).toHaveBeenCalledWith('run.end', expect.objectContaining({ exitCode: 0, timedOut: false }));
  });
});
