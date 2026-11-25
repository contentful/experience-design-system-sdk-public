import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexConnection } from '../../src/agents/services/codex-app-server/connection.js';
import { createCodexAppServerRuntime } from '../../src/agents/services/codex-app-server/runtime.js';
import type { AgentAssignment, CodexAppServerOptions } from '../../src/agents/types/invoker.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const assignment = (id: string, role = 'producer'): AgentAssignment => ({
  id,
  binding: {
    sourceDigest: hash('source'),
    rulesDigest: hash('rules'),
    toolsDigest: hash('tools'),
    contextDigest: hash('context'),
    environmentDigest: hash('environment'),
    model: 'configured-model',
    role,
  },
  inventory: [`${id}-subject`],
  admittedPrerequisites: [],
  validators: [{ path: '/immutable/validator.mjs', digest: hash('validator') }],
});
const fixture = fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(overrides: Partial<CodexAppServerOptions> = {}, fixtureEnv: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'persistent-transport-'));
  const tracePath = join(directory, 'trace.jsonl');
  const events: unknown[] = [];
  const runtime = createCodexAppServerRuntime(
    { operationId: 'test-operation', timeoutMs: 0, drainTimeoutMs: 400, requestTimeoutMs: 800, ...overrides },
    (name, payload) => events.push({ name, payload }),
    () =>
      spawn(process.execPath, [fixture], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FAKE_CODEX_TRACE: tracePath, ...fixtureEnv },
      }),
  );
  cleanups.push(async () => {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  const invoke = (id: string, prompt = id, extra: object = {}) =>
    runtime.invoke({
      agent: 'codex',
      model: 'configured-model',
      timeoutMs: 0,
      prompt,
      assignment: assignment(id),
      ...extra,
    });
  const trace = async () =>
    (await readFile(tracePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { runtime, invoke, trace, events };
}
describe('operation-owned Codex app-server (no provider, no automatic retries)', () => {
  it('rejects a new independent assignment receiving an already owned native thread', async () => {
    const { invoke, trace } = await setup({}, { FAKE_CODEX_REUSE_THREAD: '1' });
    expect((await invoke('producer')).exitCode).toBe(0);
    const checker = await invoke('checker', 'checker', { assignment: assignment('checker', 'checker') });
    expect(checker).toMatchObject({ exitCode: 1, stdout: '', transportFailure: 'duplicate-thread-owner' });
    expect(checker.conversation).toBeUndefined();
    expect((await trace()).filter((line) => line.kind === 'turn/start')).toHaveLength(1);
  });
  it('rejects duplicate native thread ownership while its first assignment is active', async () => {
    const { invoke } = await setup({}, { FAKE_CODEX_REUSE_THREAD: '1' });
    const producer = invoke('producer', 'hang');
    const checker = invoke('checker', 'checker', { assignment: assignment('checker', 'checker') });
    expect(await checker).toMatchObject({ exitCode: 1, stdout: '', transportFailure: 'duplicate-thread-owner' });
    expect(await producer).toMatchObject({ exitCode: 1, stdout: '' });
  });
  it('initializes once, isolates roles, preserves exact stdout and scoped usage', async () => {
    const { invoke, trace, events } = await setup();
    const [producer, checker] = await Promise.all([
      invoke('first'),
      invoke('second', 'second', { assignment: assignment('second', 'checker') }),
    ]);
    expect(producer.exitCode).toBe(0);
    expect(checker.stdout).toBe('FINAL:second');
    expect(producer.stdout).toBe('FINAL:first');
    expect(producer.conversation?.id).not.toBe(checker.conversation?.id);
    expect((producer as { persistentUsage?: unknown }).persistentUsage).toMatchObject({
      scope: 'last-turn',
      counters: { inputTokens: 12, cachedInputTokens: 4 },
    });
    const lines = await trace();
    expect(lines.filter((line) => line.kind === 'spawn')).toHaveLength(1);
    expect(lines.filter((line) => line.kind === 'initialize')).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('DOMAIN_POISON');
    expect(JSON.stringify(events)).not.toContain('FINAL:first');
  });
  it('repairs in the exact thread and rejects concurrent ownership and changed context', async () => {
    const { invoke, trace } = await setup();
    const first = await invoke('repair', 'failed');
    expect(first.exitCode).toBe(1);
    const repaired = await invoke('repair', 'fixed', { conversation: first.conversation });
    expect(repaired.exitCode).toBe(0);
    expect(repaired.conversation).toEqual(first.conversation);
    expect((await trace()).filter((line) => line.kind === 'thread/start')).toHaveLength(1);
    await expect(
      invoke('repair', 'foreign', { conversation: first.conversation, assignment: assignment('repair', 'checker') }),
    ).rejects.toThrow(/assignment|binding/i);
    const active = invoke('busy', 'slow');
    await expect(invoke('busy')).rejects.toThrow(/owned|active/i);
    expect((await active).exitCode).toBe(0);
  });
  it('requires exact host admission and an explicit compatible one-use related handoff', async () => {
    const { runtime, invoke, trace } = await setup();
    const first = await invoke('batch-one');
    expect(() => runtime.createHandoff('batch-one')).toThrow(/admi/i);
    expect(() => runtime.admit('batch-one', hash('wrong'), hash('admitted'))).toThrow(/digest/i);
    runtime.admit('batch-one', hash(first.stdout), hash('admitted'));
    const handoff = runtime.createHandoff('batch-one');
    const next = assignment('batch-two');
    next.admittedPrerequisites = [handoff.prerequisite];
    const incompatible = structuredClone(next);
    incompatible.binding.sourceDigest = hash('stale');
    await expect(invoke('batch-two', 'bad', { assignment: incompatible, relatedBatch: handoff })).rejects.toThrow(
      /handoff|binding/i,
    );
    await expect(
      invoke('batch-two', 'bad', { assignment: next, relatedBatch: { ...handoff, token: 'foreign' } }),
    ).rejects.toThrow(/handoff/i);
    const second = await invoke('batch-two', 'batch-two', { assignment: next, relatedBatch: handoff });
    expect(second.conversation).toEqual(first.conversation);
    const third = assignment('batch-three');
    third.admittedPrerequisites = [handoff.prerequisite];
    await expect(invoke('batch-three', 'bad', { assignment: third, relatedBatch: handoff })).rejects.toThrow(
      /handoff/i,
    );
    expect(
      (await trace()).find((line) => line.kind === 'assignment-input' && line.text.startsWith('batch-two')).text,
    ).toContain('batch-two-subject');
  });
  it.each(['malformed', 'unknown-request', 'wrong-thread', 'wrong-turn', 'empty', 'failed', 'exit'])(
    'refuses %s without admitting streamed/partial output',
    async (prompt) => {
      const { invoke } = await setup();
      const result = await invoke('negative', prompt);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain('PRIVATE_ERROR');
    },
  );
  it('recovers transport by resuming the same assignment/thread without automatic replay', async () => {
    const { invoke, trace } = await setup();
    const failed = await invoke('recover', 'exit');
    expect(failed.exitCode).not.toBe(0);
    const fixed = await invoke('recover', 'fixed', { conversation: failed.conversation });
    expect(fixed.exitCode).toBe(0);
    expect(fixed.conversation).toEqual(failed.conversation);
    const lines = await trace();
    expect(lines.filter((line) => line.kind === 'spawn')).toHaveLength(2);
    expect(lines.filter((line) => line.kind === 'thread/resume')).toHaveLength(1);
    expect(lines.filter((line) => line.kind === 'turn/start')).toHaveLength(2);
  });
  it('cancels one active job while another thread completes; joins interruption', async () => {
    const { invoke, trace } = await setup();
    const controller = new AbortController();
    const cancelled = invoke('cancel', 'hang', { signal: controller.signal });
    const survivor = invoke('survive', 'slow');
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    expect((await cancelled).exitCode).not.toBe(0);
    expect((await survivor).exitCode).toBe(0);
    expect((await trace()).filter((line) => line.kind === 'turn/interrupt')).toHaveLength(1);
  });
  it('counts queued time in finite invocation and operation budgets, preserves unlimited work', async () => {
    const { invoke } = await setup({ maxConcurrency: 1 });
    const slow = invoke('slow-job', 'slow');
    const queued = await invoke('queued', 'queued', { timeoutMs: 25 });
    expect(queued.timedOut).toBe(true);
    expect((await slow).exitCode).toBe(0);
    const finite = await setup({ timeoutMs: 30 });
    expect((await finite.invoke('deadline', 'hang')).timedOut).toBe(true);
    expect((await finite.invoke('expired')).timedOut).toBe(true);
  });
  it('rejects queued shutdown and drains the active turn before close; closes idempotently', async () => {
    const { invoke, runtime } = await setup({ maxConcurrency: 1 });
    const active = invoke('active', 'slow');
    const queued = invoke('queued');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const closing = runtime.close();
    expect((await queued).exitCode).not.toBe(0);
    expect((await active).exitCode).toBe(0);
    await closing;
    await runtime.close();
    expect((await invoke('after-close')).exitCode).not.toBe(0);
  });
  it('cancels queued work without launching a thread and bounds queue/session retention', async () => {
    const { invoke, trace } = await setup({ maxConcurrency: 1, maxQueue: 1, maxSessions: 2 });
    const slow = invoke('slow', 'slow');
    const controller = new AbortController();
    const queued = invoke('queued', 'queued', { signal: controller.signal });
    await expect(invoke('overflow')).rejects.toThrow(/queue|capacity/i);
    controller.abort();
    expect((await queued).exitCode).not.toBe(0);
    await slow;
    expect((await trace()).filter((line) => line.kind === 'thread/start')).toHaveLength(1);
    expect((await invoke('second')).exitCode).toBe(0);
    await expect(invoke('third')).rejects.toThrow(/session|capacity/i);
  });
  it('retains oversized prompt artifacts across failed-turn repair until operation drain', async () => {
    const { invoke, runtime, trace } = await setup();
    const failed = await invoke('artifact', 'failed\n' + 'x'.repeat(1_048_576));
    expect(failed.exitCode).toBe(1);
    const delivered = (await trace()).find((line) => line.kind === 'assignment-input').text;
    const path = JSON.parse(delivered.match(/Prompt artifact: (".*")/)[1]);
    expect(await readFile(path, 'utf8')).toContain('artifact-subject');
    const repaired = await invoke('artifact', 'fixed', { conversation: failed.conversation });
    expect(repaired.exitCode).toBe(0);
    expect(await readFile(path, 'utf8')).toContain('failed');
    await runtime.close();
    await expect(readFile(path)).rejects.toThrow();
  });
  it('allows exact repair after launch failure before any native identity exists', async () => {
    let starts = 0;
    const runtime = createCodexAppServerRuntime(
      { operationId: 'startup-repair', timeoutMs: 0, drainTimeoutMs: 100 },
      undefined,
      () =>
        ++starts === 1
          ? spawn(process.execPath, ['-e', 'process.exit(7)'], { stdio: ['pipe', 'pipe', 'pipe'] })
          : spawn(process.execPath, [fixture], { stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    cleanups.push(() => runtime.close());
    const input = {
      agent: 'codex' as const,
      model: 'configured-model',
      prompt: 'recover',
      timeoutMs: 0,
      assignment: assignment('startup'),
    };
    const failed = await runtime.invoke(input);
    expect(failed.exitCode).not.toBe(0);
    expect(failed.conversation).toBeUndefined();
    expect((await runtime.invoke(input)).exitCode).toBe(0);
    expect(starts).toBe(2);
  });

  it('enforces active finite deadlines after initialization and preserves shared operation budget', async () => {
    const { invoke, trace } = await setup();
    expect((await invoke('warm')).exitCode).toBe(0);
    const deadline = await invoke('active-deadline', 'hang', { timeoutMs: 25 });
    expect(deadline.timedOut).toBe(true);
    expect((await trace()).filter((line) => line.kind === 'turn/interrupt')).toHaveLength(1);
    expect((await invoke('still-alive')).exitCode).toBe(0);
  });
  it.each([
    ['rate-limited', 'rateLimitExceeded'],
    ['unauthorized', 'unauthorized'],
  ])('retains the official %s failure classification without provider message text', async (prompt, reason) => {
    const { invoke } = await setup();
    const result = await invoke('classified', prompt);
    expect(result).toMatchObject({ exitCode: 1, stdout: '', transportFailure: reason });
    expect(result.stderr).not.toContain('PRIVATE_ERROR');
  });
  it.each(['buffer', 'unsupported-request'])('bounds and rejects %s protocol traffic', async (prompt) => {
    const { invoke } = await setup({ maxBufferBytes: 4096 });
    const result = await invoke('bounded', prompt);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
  });
  it('closes a hung active turn within the shutdown drain watchdog', async () => {
    const { invoke, runtime } = await setup({ drainTimeoutMs: 100 });
    expect((await invoke('warm')).exitCode).toBe(0);
    const pending = invoke('hung', 'hang');
    await new Promise((resolve) => setTimeout(resolve, 25));
    await runtime.close();
    expect((await pending).exitCode).not.toBe(0);
  });
  it('classifies broken stdin and drains the process without returning an answer', async () => {
    let child: ReturnType<typeof spawn> | undefined;
    const runtime = createCodexAppServerRuntime(
      { operationId: 'broken-stdin', timeoutMs: 0, drainTimeoutMs: 100 },
      undefined,
      () => {
        const process = spawn(globalThis.process.execPath, [fixture], { stdio: ['pipe', 'pipe', 'pipe'] });
        child = process;
        return process;
      },
    );
    cleanups.push(() => runtime.close());
    const input = {
      agent: 'codex' as const,
      model: 'configured-model',
      prompt: 'first',
      timeoutMs: 0,
      assignment: assignment('first'),
    };
    expect((await runtime.invoke(input)).exitCode).toBe(0);
    child!.stdin!.destroy();
    expect(await runtime.invoke({ ...input, assignment: assignment('second') })).toMatchObject({
      exitCode: 1,
      stdout: '',
      transportFailure: 'broken-stdin',
    });
  });
  it('reaps owned process-group descendants after the server exits before turn completion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'persistent-group-'));
    const tracePath = join(directory, 'trace.jsonl');
    const child = spawn(process.execPath, [fixture], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, FAKE_CODEX_TRACE: tracePath },
    });
    const connection = new CodexConnection(
      child,
      4 * 1024 * 1024,
      800,
      100,
      () => {},
      () => {},
      true,
    );
    let orphanPid: number | undefined;
    const alive = () => {
      try {
        process.kill(orphanPid!, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      await connection.ready;
      const response = (await connection.request('thread/start', { model: 'configured-model' })) as any;
      await connection.request('turn/start', {
        threadId: response.thread.id,
        input: [{ type: 'text', text: 'orphan-exit' }],
      });
      await connection.closed;
      await connection.close();
      const records = (await readFile(tracePath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      orphanPid = records.find((line) => line.kind === 'orphan').pid;
      const until = performance.now() + 200;
      while (alive() && performance.now() < until) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(alive()).toBe(false);
    } finally {
      if (orphanPid && alive()) process.kill(orphanPid, 'SIGKILL');
      await connection.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
