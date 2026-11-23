import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodexAppServerRuntime } from '../../dist/src/agents/services/codex-app-server/runtime.js';
import type { AgentAssignment, CodexAppServerOptions, InvokeAgentOptions } from '../../src/agents/types/invoker.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fixture = fileURLToPath(new URL('./fixtures/retired-turn-app-server.mjs', import.meta.url));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const orders = ['response-first', 'notification-first'] as const;
async function setup(options: Partial<CodexAppServerOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'retired-turn-'));
  const tracePath = join(directory, 'trace.jsonl');
  const children: ChildProcessWithoutNullStreams[] = [];
  const runtime = createCodexAppServerRuntime(
    { operationId: 'retired-turn-control', timeoutMs: 0, requestTimeoutMs: 1500, drainTimeoutMs: 200, ...options },
    undefined,
    () => {
      const child = spawn(process.execPath, [fixture], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, RETIRED_TURN_TRACE: tracePath },
      });
      children.push(child);
      return child;
    },
  );
  const assignment = (id: string): AgentAssignment => ({
    id,
    binding: {
      sourceDigest: hash('source'),
      rulesDigest: hash('rules'),
      toolsDigest: hash('tools'),
      contextDigest: hash('context'),
      environmentDigest: hash('environment'),
      model: 'fixture-model',
      role: id === 'checker' ? 'checker' : 'producer',
    },
    inventory: [`${id}-subject`],
    validators: [{ path: '/immutable/validator.mjs', digest: hash('validator') }],
    admittedPrerequisites: [],
  });
  const invoke = (id: string, plan: object = {}, extra: Partial<InvokeAgentOptions> = {}) =>
    runtime.invoke({
      agent: 'codex',
      model: 'fixture-model',
      timeoutMs: 0,
      prompt: JSON.stringify({ output: `FINAL:${id}`, ...plan }),
      assignment: assignment(id),
      ...extra,
    });
  const trace = async (): Promise<{ kind: string; threadId?: string; turnId?: string }[]> =>
    (await readFile(tracePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  cleanups.push(async () => {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { runtime, invoke, trace, children };
}

describe('completed native turn identities in the compiled transport', () => {
  it.each(orders)('accepts fresh identities in the exact repair conversation with %s', async (order) => {
    const { invoke, trace } = await setup();
    const first = await invoke('owner', { order });
    expect(first.exitCode).toBe(0);
    const next = await invoke('owner', { order, output: 'FRESH' }, { conversation: first.conversation });
    expect(next).toMatchObject({ exitCode: 0, stdout: 'FRESH', conversation: first.conversation });
    const ids = (await trace()).filter((row) => row.kind === 'turn/start').map((row) => row.turnId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it.each(orders)('refuses a reused most recent identity with %s', async (order) => {
    const { runtime, invoke } = await setup();
    const first = await invoke('owner', { order });
    expect(first.exitCode).toBe(0);
    const reused = await invoke('owner', { mode: 'reuse', order }, { conversation: first.conversation });
    expect(reused).toMatchObject({ exitCode: 1, stdout: '', transportFailure: 'reused-turn-identity' });
    expect(reused.conversation).toEqual(first.conversation);
    expect(() => runtime.admit('owner', hash('FINAL:owner'), hash('admission'))).toThrow();
    expect(() => runtime.createHandoff('owner')).toThrow();
    const repaired = await invoke('owner', { order }, { conversation: reused.conversation });
    expect(repaired).toMatchObject({ exitCode: 0, stdout: 'FINAL:owner', conversation: first.conversation });
  });

  it.each(orders)('refuses an older completed identity with %s', async (order) => {
    const { invoke } = await setup();
    const first = await invoke('owner', { order });
    expect((await invoke('owner', { order }, { conversation: first.conversation })).exitCode).toBe(0);
    expect(
      await invoke('owner', { mode: 'reuse', reuseIndex: 0, order }, { conversation: first.conversation }),
    ).toMatchObject({ exitCode: 1, stdout: '', transportFailure: 'reused-turn-identity' });
  });

  it.each(orders)(
    'ignores older and recent retired notifications while fresh interleaved turns finish with %s',
    async (order) => {
      const { invoke } = await setup();
      const first = await invoke('owner', { order });
      expect((await invoke('owner', { order }, { conversation: first.conversation })).exitCode).toBe(0);
      const [current, checker] = await Promise.all([
        invoke('owner', { mode: 'late', order, output: 'CURRENT' }, { conversation: first.conversation }),
        invoke('checker', { order, delayMs: 60 }),
      ]);
      expect(current).toMatchObject({ exitCode: 0, stdout: 'CURRENT', conversation: first.conversation });
      expect(checker).toMatchObject({ exitCode: 0, stdout: 'FINAL:checker' });
      expect(checker.conversation!.id).not.toBe(current.conversation!.id);
    },
  );

  it('keeps retired identities through process reopening and allows a fresh exact-conversation repair', async () => {
    const { invoke, children, trace } = await setup();
    const first = await invoke('owner');
    const reusedId = (await trace()).find((row) => row.kind === 'completed')!.turnId;
    children[0]!.stdin.destroy();
    const broken = await invoke('owner', {}, { conversation: first.conversation });
    expect(broken).toMatchObject({ exitCode: 1, stdout: '', transportFailure: 'broken-stdin' });
    expect(await invoke('owner', { reusedId }, { conversation: broken.conversation })).toMatchObject({
      exitCode: 1,
      stdout: '',
      transportFailure: 'reused-turn-identity',
    });
    expect(await invoke('owner', {}, { conversation: first.conversation })).toMatchObject({
      exitCode: 0,
      stdout: 'FINAL:owner',
      conversation: first.conversation,
    });
  });

  it('bounds retained identities without evicting completed evidence or launching overflow work', async () => {
    const { invoke, trace, runtime } = await setup({ maxSessions: 1 });
    let conversation: InvokeAgentOptions['conversation'];
    for (let index = 0; index < 8; index++) {
      const result = await invoke('owner', {}, { conversation });
      expect(result.exitCode).toBe(0);
      conversation = result.conversation;
    }
    expect(await invoke('owner', {}, { conversation })).toMatchObject({
      exitCode: 1,
      stdout: '',
      transportFailure: 'turn-identity-capacity',
    });
    expect((await trace()).filter((row) => row.kind === 'turn/start')).toHaveLength(8);
    expect(() => runtime.admit('owner', hash('FINAL:owner'), hash('admission'))).toThrow();
  });
});
