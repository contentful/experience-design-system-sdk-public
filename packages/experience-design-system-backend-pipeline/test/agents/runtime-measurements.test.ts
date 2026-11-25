import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from '../../src/agents/services/run-agent.js';
import { createLocalCliAgentInvoker } from '../../src/agents/invoker/create-local-cli-agent-invoker.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const event = (value: unknown) => `${JSON.stringify(value)}\n`;
const codex = (usage?: unknown) =>
  event({ type: 'thread.started', thread_id: id }) +
  event({ type: 'item.completed', item: { type: 'agent_message', text: '{"complete":true}' } }) +
  event({ type: 'turn.completed', ...(usage === undefined ? {} : { usage }) });

function fakeProcess(write: (child: ReturnType<typeof childProcess>) => void) {
  vi.mocked(spawn).mockImplementationOnce(() => {
    const child = childProcess();
    setImmediate(() => write(child));
    return child as unknown as ReturnType<typeof spawn>;
  });
}
function childProcess() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}

describe('local runtime measurements', () => {
  let now: number;
  beforeEach(() => {
    now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.mocked(spawn).mockReset();
    vi.stubEnv('EDS_BEDROCK', '0');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('separates launch, OS spawn, first bytes and first complete native event without leaking content', async () => {
    fakeProcess((child) => {
      now = 107;
      child.emit('spawn');
      now = 111;
      child.stderr.write('private diagnostic');
      now = 117;
      child.stdout.write('{"type":"thread.');
      now = 125;
      child.stdout.write(`started","thread_id":"${id}"}\n`);
      now = 130;
      child.stdout.end(codex({ input_tokens: 100, cached_input_tokens: 70, output_tokens: 12 }));
      now = 140;
      child.emit('close', 0, null);
    });
    const debug = vi.fn();
    const result = await runAgent({
      agent: 'codex',
      model: 'configured-model',
      prompt: 'private prompt',
      timeoutMs: 0,
      preserveConversation: true,
      onDebugEvent: debug,
    });
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: '{"complete":true}',
      conversation: { agent: 'codex', id },
      measurements: {
        transport: 'local-cli',
        agent: 'codex',
        model: 'configured-model',
        invocationElapsedMs: 40,
        launchAfterMs: 0,
        startupMs: 7,
        firstOutputMs: 11,
        firstStdoutMs: 17,
        firstEventMs: 25,
        processElapsedMs: 40,
      },
      nativeUsage: {
        source: 'codex.turn.completed.usage',
        scope: 'turn',
        counters: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 12 },
      },
    });
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private prompt');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private diagnostic');
    expect(debug.mock.calls.map(([name]) => name)).toContain('run.measurements');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('keeps missing spawn/event/usage observations absent for plain output', async () => {
    fakeProcess((child) => {
      now = 110;
      child.stdout.end('plain response');
      now = 120;
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'copilot', prompt: 'task', timeoutMs: 0 });
    expect(result.measurements).toMatchObject({ firstStdoutMs: 10, firstOutputMs: 10, processElapsedMs: 20 });
    expect(result.measurements?.startupMs).toBeUndefined();
    expect(result.measurements?.firstEventMs).toBeUndefined();
    expect(result.nativeUsage).toBeUndefined();
  });

  it('keeps prelaunch cancellation free of fabricated launch measurements', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runAgent({ agent: 'codex', prompt: 'task', timeoutMs: 0, signal: controller.signal });
    expect(result.exitCode).toBe(1);
    expect(result.measurements).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([0, 5])('preserves active cancellation and exact repair identity with deadline %s', async (timeoutMs) => {
    const controller = new AbortController();
    fakeProcess((child) => {
      child.emit('spawn');
      child.stdout.write(event({ type: 'thread.started', thread_id: id }));
      now = 113;
      controller.abort();
      now = 114;
      child.emit('close', null, 'SIGTERM');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });
    const result = await createLocalCliAgentInvoker().invoke({
      agent: 'codex',
      prompt: 'repair',
      timeoutMs,
      conversation: { agent: 'codex', id },
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      timedOut: false,
      conversation: { agent: 'codex', id },
      measurements: { processElapsedMs: 14 },
    });
    expect(vi.mocked(spawn).mock.calls[0][1]).toContain(id);
    expect(result.nativeUsage).toBeUndefined();
  });

  it('records failed launch time without inventing startup/output/usage', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      now = 104;
      throw new Error('launch failed');
    });
    const result = await runAgent({ agent: 'claude', prompt: 'task', timeoutMs: 0 });
    expect(result).toMatchObject({ exitCode: 1, measurements: { launchAfterMs: 0, processElapsedMs: 4 } });
    expect(result.measurements?.startupMs).toBeUndefined();
    expect(result.measurements?.firstOutputMs).toBeUndefined();
  });

  it('takes the latest native cumulative snapshot without summing duplicates or content lookalikes', async () => {
    const final = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20 };
    fakeProcess((child) => {
      child.stdout.end(
        event({ type: 'thread.started', thread_id: id }) +
          event({
            type: 'item.completed',
            item: { type: 'agent_message', text: 'answer', usage: { input_tokens: 9999 } },
          }) +
          event({ type: 'turn.completed', usage: { input_tokens: 50, output_tokens: 10 } }) +
          event({ type: 'turn.completed', usage: final }) +
          event({ type: 'turn.completed', usage: final }),
      );
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'codex', prompt: 'task', timeoutMs: 0, preserveConversation: true });
    expect(result.nativeUsage?.counters).toEqual(final);
  });

  it('ignores malformed counters and unrelated events while preserving decoder failure', async () => {
    fakeProcess((child) => {
      child.stdout.end(
        'malformed\n' +
          event({ type: 'thread.started', thread_id: id }) +
          event({
            type: 'turn.completed',
            usage: { input_tokens: -1, output_tokens: '3', cached_input_tokens: null, credentials: 'secret' },
          }),
      );
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'codex', prompt: 'task', timeoutMs: 0, preserveConversation: true });
    expect(result.exitCode).toBe(1);
    expect(result.nativeUsage).toBeUndefined();
    expect(JSON.stringify(result.nativeUsage ?? {})).not.toContain('secret');
  });

  it('suppresses usage attribution for an interleaved foreign native conversation', async () => {
    fakeProcess((child) => {
      child.stdout.end(
        codex({ input_tokens: 10 }) +
          event({ type: 'thread.started', thread_id: '22222222-2222-4222-8222-222222222222' }) +
          event({ type: 'turn.completed', usage: { input_tokens: 999 } }),
      );
      child.emit('close', 0, null);
    });
    const result = await runAgent({
      agent: 'codex',
      prompt: 'repair',
      timeoutMs: 0,
      conversation: { agent: 'codex', id },
    });
    expect(result.exitCode).toBe(1);
    expect(result.conversation).toEqual({ agent: 'codex', id });
    expect(result.nativeUsage).toBeUndefined();
  });

  it('does not carry an earlier usage snapshot into a completion with missing counters', async () => {
    fakeProcess((child) => {
      child.stdout.end(codex({ input_tokens: 10 }) + event({ type: 'turn.completed' }));
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'codex', prompt: 'task', timeoutMs: 0, preserveConversation: true });
    expect(result.nativeUsage).toBeUndefined();
  });

  it('preserves zero and partial counters but rejects unsafe numbers and unknown fields', async () => {
    fakeProcess((child) => {
      child.stdout.end(
        codex({ input_tokens: 0, output_tokens: 1.5, cached_input_tokens: Number.MAX_SAFE_INTEGER + 1, unknown: 900 }),
      );
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'codex', prompt: 'task', timeoutMs: 0, preserveConversation: true });
    expect(result.nativeUsage?.counters).toEqual({ input_tokens: 0 });
  });

  it('withholds a malformed Codex snapshot whose cached input exceeds reported input', async () => {
    fakeProcess((child) => {
      child.stdout.end(codex({ input_tokens: 3, cached_input_tokens: 10, output_tokens: 4 }));
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'codex', prompt: 'task', timeoutMs: 0, preserveConversation: true });
    expect(result.exitCode).toBe(0);
    expect(result.nativeUsage).toBeUndefined();
  });

  it('keeps JSON domain output and unknown event kinds outside native event/usage telemetry', async () => {
    fakeProcess((child) => {
      now = 110;
      child.stdout.end(event({ type: 'result', usage: { input_tokens: 100 } }));
      now = 120;
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'codex', prompt: 'task', timeoutMs: 0 });
    expect(result.measurements?.firstEventMs).toBeUndefined();
    expect(result.nativeUsage).toBeUndefined();
  });

  it('timestamps a final native event without a newline at byte arrival rather than close', async () => {
    fakeProcess((child) => {
      now = 110;
      child.stdout.end(JSON.stringify({ type: 'thread.started', thread_id: id }));
      now = 140;
      child.emit('close', 1, null);
    });
    const result = await runAgent({ agent: 'codex', prompt: 'task', timeoutMs: 0, preserveConversation: true });
    expect(result.measurements?.firstEventMs).toBe(10);
    expect(result.measurements?.processElapsedMs).toBe(40);
  });

  it('retains only reported Claude native result totals, including independent cache counters', async () => {
    const counters = {
      input_tokens: 10,
      output_tokens: 7,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    };
    fakeProcess((child) => {
      child.stdout.end(
        event({ type: 'assistant', session_id: id, message: { content: [], usage: { input_tokens: 999 } } }) +
          event({ type: 'result', subtype: 'success', session_id: id, result: 'answer', usage: counters }),
      );
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'claude', prompt: 'task', timeoutMs: 0, preserveConversation: true });
    expect(result.nativeUsage).toEqual({ source: 'claude.result.usage', scope: 'invocation', counters });
  });

  it.each(['cursor', 'copilot'] as const)(
    'does not infer %s usage from Claude-shaped or domain data',
    async (agent) => {
      fakeProcess((child) => {
        child.stdout.end(
          event({ type: 'result', subtype: 'success', session_id: id, result: 'answer', usage: { input_tokens: 99 } }),
        );
        child.emit('close', 0, null);
      });
      const result = await runAgent({ agent, prompt: 'task', timeoutMs: 0, preserveConversation: true });
      expect(result.nativeUsage).toBeUndefined();
    },
  );

  it('preserves native OpenCode last-step counters without adding cache/input fields together', async () => {
    fakeProcess((child) => {
      child.stdout.end(
        event({ type: 'text', sessionID: 'ses_example', part: { text: 'answer' } }) +
          event({
            type: 'step_finish',
            sessionID: 'ses_example',
            part: { reason: 'stop', tokens: { input: 8, output: 4, reasoning: 2, cache: { read: 6, write: 1 } } },
          }),
      );
      child.emit('close', 0, null);
    });
    const result = await runAgent({ agent: 'opencode', prompt: 'task', timeoutMs: 0, preserveConversation: true });
    expect(result.nativeUsage).toEqual({
      source: 'opencode.step_finish.part.tokens',
      scope: 'step',
      counters: { input: 8, output: 4, reasoning: 2, 'cache.read': 6, 'cache.write': 1 },
    });
  });
});
