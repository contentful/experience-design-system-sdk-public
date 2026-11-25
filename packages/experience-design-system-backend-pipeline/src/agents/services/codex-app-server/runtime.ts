import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  createAgentPromptArtifact,
  shouldUsePromptArtifact,
  type AgentPromptArtifact,
} from '@contentful/experience-design-system-types';
import { isRecord, isUuid } from '../../helpers/agent-event-values.js';
import { decodeCodexConversationOutput } from '../../helpers/codex-conversation-output.js';
import { resolveAgentModel } from '../../helpers/resolution/resolve-agent-model.js';
import { resolveBinary } from '../../helpers/resolution/resolve-binary.js';
import { checkAgentAuth } from '../check-agent-auth.js';
import type { AgentDebugEvent } from '../../types/agent-run.js';
import type {
  PersistentAgentInvoker,
  CodexAppServerOptions,
  InvokeAgentOptions,
  PersistentAgentMeasurements,
  PersistentAgentRunResult,
  PersistentAgentUsage,
} from '../../types/invoker.js';
import { AssignmentSessions, digest } from './assignments.js';
import { CodexConnection, CodexTransportError } from './connection.js';
import { readTurnFailure } from './turn-failure.js';

interface Turn {
  id?: string;
  output?: string;
  usage?: PersistentAgentUsage;
  firstEventMs?: number;
  firstOutputMs?: number;
  startedAt: number;
  onOutput?: (chunk: string) => void;
  settle: (result: { output?: string; failure?: string }) => void;
  interrupting?: boolean;
  providerFailure?: { code: string; httpStatusCode?: number };
}
interface Job {
  controller: AbortController;
  reason?: 'cancelled' | 'timeout' | 'shutdown';
  queued?: (acquired: boolean) => void;
  finished: Promise<void>;
}
function positive(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
    throw new Error('Invalid persistent transport limit');
  return result;
}

export function createCodexAppServerRuntime(
  options: CodexAppServerOptions,
  debug?: AgentDebugEvent,
  spawnProcess?: () => ChildProcessWithoutNullStreams,
): PersistentAgentInvoker {
  if (!options.operationId || !Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
    throw new Error('Persistent transport requires an operation identity and budget');
  const concurrency = positive(options.maxConcurrency, 4, 128);
  const maxQueue = positive(options.maxQueue, 128, 4096);
  const maxSessions = positive(options.maxSessions, 1024, 16384);
  const maxRetiredTurns = maxSessions * 8;
  const bufferLimit = positive(options.maxBufferBytes, 4 * 1024 * 1024, 64 * 1024 * 1024);
  const requestTimeout = positive(options.requestTimeoutMs, 30000, 300000);
  const drainTimeout = positive(options.drainTimeoutMs, 5000, 60000);
  const deadline = options.timeoutMs === 0 ? Infinity : performance.now() + options.timeoutMs;
  const environment = { ...process.env };
  const binary = resolveBinary('codex');
  const sessions = new AssignmentSessions(options.operationId, maxSessions);
  const busy = new Set<string>();
  const jobs = new Set<Job>();
  const queue: Job[] = [];
  const turns = new Map<string, Turn>();
  const retired = new Map<string, Set<string>>();
  let retiredTurnCount = 0;
  const retainedArtifacts = new Map<string, AgentPromptArtifact[]>();
  let running = 0;
  let connection: CodexConnection | undefined;
  let closing = false;
  let closePromise: Promise<void> | undefined;

  const emit = (name: string, payload: Record<string, unknown>) => {
    try {
      debug?.(name, payload);
    } catch {}
  };
  const unmeasuredFailure = (reason: string, timedOut = false): PersistentAgentRunResult => ({
    exitCode: 1,
    stdout: '',
    stderr: `Codex app-server transport: ${reason}`,
    timedOut,
    transportFailure: reason,
  });
  const notify = (method: string, value: unknown) => {
    if (
      ![
        'turn/started',
        'turn/completed',
        'item/completed',
        'item/agentMessage/delta',
        'thread/tokenUsage/updated',
        'model/rerouted',
      ].includes(method)
    )
      return;
    if (!isRecord(value) || typeof value.threadId !== 'string') throw new CodexTransportError('malformed-event');
    const turn = turns.get(value.threadId);
    const id = method.startsWith('turn/') && isRecord(value.turn) ? value.turn.id : value.turnId;
    if (typeof id === 'string' && retired.get(value.threadId)?.has(id) && turn?.id !== id) return;
    if (!turn) {
      throw new CodexTransportError('wrong-thread');
    }
    if (method === 'model/rerouted') throw new CodexTransportError('model-rerouted');
    if (typeof id !== 'string' || !isUuid(id)) throw new CodexTransportError('malformed-turn-identity');
    if (method === 'turn/started' && !turn.id) turn.id = id;
    if (turn.id !== id) throw new CodexTransportError('wrong-turn');
    turn.firstEventMs ??= performance.now() - turn.startedAt;
    if (method === 'item/agentMessage/delta') {
      if (typeof value.delta !== 'string' || typeof value.itemId !== 'string')
        throw new CodexTransportError('malformed-event');
      turn.firstOutputMs ??= performance.now() - turn.startedAt;
      try {
        turn.onOutput?.(value.delta);
      } catch {}
    } else if (method === 'item/completed') {
      if (!isRecord(value.item) || typeof value.item.type !== 'string' || typeof value.item.id !== 'string')
        throw new CodexTransportError('malformed-item');
      if (value.item.type !== 'agentMessage') return;
      if (typeof value.item.text !== 'string') throw new CodexTransportError('malformed-item');
      if (Buffer.byteLength(value.item.text) > bufferLimit) throw new CodexTransportError('buffer-limit');
      if (value.item.phase === 'commentary' || value.item.phase === 'partial_answer') return;
      if (value.item.phase != null && value.item.phase !== 'final_answer')
        throw new CodexTransportError('malformed-item-phase');
      turn.output = value.item.text;
    } else if (method === 'thread/tokenUsage/updated') {
      const last = isRecord(value.tokenUsage) ? value.tokenUsage.last : undefined;
      if (!isRecord(last)) return;
      const counters: Record<string, number> = {};
      for (const key of [
        'inputTokens',
        'cachedInputTokens',
        'cacheWriteInputTokens',
        'outputTokens',
        'reasoningOutputTokens',
        'totalTokens',
      ]) {
        const count = last[key];
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) counters[key] = count;
      }
      if (
        counters.cachedInputTokens !== undefined &&
        counters.inputTokens !== undefined &&
        counters.cachedInputTokens > counters.inputTokens
      )
        return;
      if (Object.keys(counters).length)
        turn.usage = { source: 'codex.app-server.thread/tokenUsage/updated', scope: 'last-turn', counters };
    } else if (method === 'turn/completed') {
      if (!isRecord(value.turn) || !Array.isArray(value.turn.items)) throw new CodexTransportError('malformed-turn');
      if (!['completed', 'failed', 'interrupted'].includes(String(value.turn.status)))
        throw new CodexTransportError('malformed-turn');
      turn.providerFailure = readTurnFailure(value.turn.error);
      if (value.turn.status === 'completed' && turn.output?.trim()) turn.settle({ output: turn.output });
      else
        turn.settle({
          failure:
            value.turn.status === 'completed'
              ? 'missing-final-response'
              : value.turn.status === 'interrupted'
                ? 'interrupted'
                : (turn.providerFailure?.code ?? 'turn-failed'),
        });
    }
  };
  const getConnection = async (): Promise<CodexConnection> => {
    if (connection && !connection.alive) {
      const previous = connection;
      await previous.close();
      if (connection === previous) connection = undefined;
    }
    if (!connection) {
      const child = spawnProcess
        ? spawnProcess()
        : spawn(binary, ['app-server', '--listen', 'stdio://'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: environment,
            detached: true,
          });
      emit('run.transport.start', { transport: 'codex-app-server', agent: 'codex' });
      connection = new CodexConnection(
        child,
        bufferLimit,
        requestTimeout,
        drainTimeout,
        notify,
        (error) => {
          for (const turn of turns.values()) turn.settle({ failure: error.reason });
        },
        !spawnProcess,
      );
    }
    const current = connection;
    return current;
  };
  const acquire = (job: Job): Promise<boolean> => {
    if (job.controller.signal.aborted || closing) return Promise.resolve(false);
    if (running < concurrency) {
      running++;
      return Promise.resolve(true);
    }
    if (queue.length >= maxQueue) throw new Error('Persistent transport queue capacity exceeded');
    return new Promise((resolve) => {
      job.queued = resolve;
      queue.push(job);
    });
  };
  const release = () => {
    running--;
    while (!closing && queue.length && running < concurrency) {
      const next = queue.shift()!;
      const resolve = next.queued;
      next.queued = undefined;
      if (!next.controller.signal.aborted) {
        running++;
        resolve?.(true);
      } else resolve?.(false);
    }
  };
  const cancel = (job: Job, reason: Job['reason']) => {
    if (job.controller.signal.aborted) return;
    job.reason = reason;
    job.controller.abort();
    if (job.queued) {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      job.queued(false);
      job.queued = undefined;
    }
  };

  const invoke = async (request: InvokeAgentOptions): Promise<PersistentAgentRunResult> => {
    const input = {
      ...request,
      conversation: request.conversation && structuredClone(request.conversation),
      relatedBatch: request.relatedBatch && structuredClone(request.relatedBatch),
    };
    const started = performance.now();
    if (closing) return unmeasuredFailure('shutdown');
    if (input.agent !== 'codex' || (input.bedrock ?? process.env.EDS_BEDROCK === '1'))
      throw new Error('Persistent transport only accepts non-Bedrock Codex');
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 0) throw new Error('Invalid invocation budget');
    const model = resolveAgentModel('codex', input.model)!;
    const assignment = sessions.snapshot(input.assignment!, model);
    if (Buffer.byteLength(input.prompt) > 32 * 1024 * 1024) throw new Error('Persistent prompt capacity exceeded');
    if (busy.has(assignment.id)) throw new Error('Assignment already actively owned');
    busy.add(assignment.id);
    let finish!: () => void;
    const job: Job = {
      controller: new AbortController(),
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
    };
    jobs.add(job);
    const measurements: PersistentAgentMeasurements = {
      transport: 'codex-app-server',
      invocationElapsedMs: 0,
      queueMs: 0,
    };
    let persistentUsage: PersistentAgentUsage | undefined;
    const failureResult = (reason: string, timedOut = false): PersistentAgentRunResult => ({
      ...unmeasuredFailure(reason, timedOut),
      persistentMeasurements: measurements,
    });
    const ownDeadline = input.timeoutMs === 0 ? Infinity : started + input.timeoutMs;
    const remaining = Math.min(deadline, ownDeadline) - performance.now();
    let timer: NodeJS.Timeout | undefined;
    const checkDeadline = () => {
      const left = Math.min(deadline, ownDeadline) - performance.now();
      if (left <= 0) cancel(job, 'timeout');
      else timer = setTimeout(checkDeadline, Math.min(left, 2147483647));
    };
    if (Number.isFinite(remaining) && remaining > 0) checkDeadline();
    const onAbort = () => cancel(job, 'cancelled');
    input.signal?.addEventListener('abort', onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
    if (remaining <= 0) cancel(job, 'timeout');
    let acquired = false;
    let session: ReturnType<AssignmentSessions['claim']> | undefined;
    let current: CodexConnection | undefined;
    let artifact: AgentPromptArtifact | undefined;
    let threadId: string | undefined;
    try {
      acquired = await acquire(job);
      measurements.queueMs = performance.now() - started;
      if (!acquired || job.controller.signal.aborted)
        return failureResult(job.reason ?? 'shutdown', job.reason === 'timeout');
      session = sessions.claim(
        assignment,
        input.conversation && structuredClone(input.conversation),
        input.relatedBatch && structuredClone(input.relatedBatch),
      );
      current = await getConnection();
      await current.ready;
      measurements.startupMs = current.startupMs;
      measurements.initializationMs = current.initializationMs;
      if (job.controller.signal.aborted) return failureResult(job.reason!, job.reason === 'timeout');
      if (!session.conversation || session.connection !== current) {
        const params = { model, approvalPolicy: 'never', sandbox: 'danger-full-access' };
        const response = await current.request(session.conversation ? 'thread/resume' : 'thread/start', {
          ...params,
          ...(session.conversation ? { threadId: session.conversation.id, excludeTurns: true } : {}),
        });
        if (
          !isRecord(response) ||
          !isRecord(response.thread) ||
          typeof response.thread.id !== 'string' ||
          !isUuid(response.thread.id)
        )
          throw new CodexTransportError('invalid-thread-identity');
        if (session.conversation && response.thread.id !== session.conversation.id)
          throw new CodexTransportError('wrong-thread');
        if (response.model !== model) throw new CodexTransportError('model-mismatch');
        if (sessions.hasOtherThreadOwner(session, response.thread.id))
          throw new CodexTransportError('duplicate-thread-owner');
        session.conversation = { agent: 'codex', id: response.thread.id };
        session.connection = current;
      }
      threadId = session.conversation.id;
      if (job.controller.signal.aborted)
        return { ...failureResult(job.reason!, job.reason === 'timeout'), conversation: session.conversation };
      const prompt = input.prompt + '\n\nImmutable assignment handoff:\n' + JSON.stringify(assignment);
      if (shouldUsePromptArtifact('codex', prompt)) {
        const retained = retainedArtifacts.get(assignment.id) ?? [];
        if (retained.length >= 8) throw new Error('Persistent prompt artifact capacity exceeded');
        artifact = await createAgentPromptArtifact(prompt, job.controller.signal);
        retained.push(artifact);
        retainedArtifacts.set(assignment.id, retained);
      }
      if (job.controller.signal.aborted)
        return { ...failureResult(job.reason!, job.reason === 'timeout'), conversation: session.conversation };
      if (retiredTurnCount + turns.size >= maxRetiredTurns)
        return { ...failureResult('turn-identity-capacity'), conversation: session.conversation };
      let settle!: Turn['settle'];
      const completed = new Promise<{ output?: string; failure?: string }>((resolve) => {
        settle = resolve;
      });
      const turn: Turn = { settle, startedAt: performance.now(), onOutput: input.onOutput };
      turns.set(threadId, turn);
      let interruptTimer: NodeJS.Timeout | undefined;
      const interrupt = () => {
        if (!turn.id || turn.interrupting) return;
        turn.interrupting = true;
        interruptTimer = setTimeout(
          () => current!.fail(new CodexTransportError('interrupt-drain-timeout')),
          drainTimeout,
        );
        void current!
          .request('turn/interrupt', { threadId, turnId: turn.id })
          .catch(() => current!.fail(new CodexTransportError('interrupt-failed')));
      };
      job.controller.signal.addEventListener('abort', interrupt);
      try {
        const response = await current.request('turn/start', {
          threadId,
          model,
          input: [{ type: 'text', text: artifact?.prompt ?? prompt }],
        });
        if (
          !isRecord(response) ||
          !isRecord(response.turn) ||
          typeof response.turn.id !== 'string' ||
          !isUuid(response.turn.id)
        )
          throw new CodexTransportError('invalid-turn-identity');
        if (retired.get(threadId)?.has(response.turn.id)) throw new CodexTransportError('reused-turn-identity');
        if (turn.id && turn.id !== response.turn.id) throw new CodexTransportError('wrong-turn');
        turn.id = response.turn.id;
        if (job.controller.signal.aborted) interrupt();
        const outcome = await completed;
        persistentUsage = turn.usage;
        measurements.firstEventMs = turn.firstEventMs;
        measurements.firstOutputMs = turn.firstOutputMs;
        measurements.turnElapsedMs = performance.now() - turn.startedAt;
        if (!current.alive) {
          await current.close();
          return {
            ...failureResult(job.reason ?? current.failureReason ?? 'closed', job.reason === 'timeout'),
            conversation: session.conversation,
          };
        }
        if (job.controller.signal.aborted)
          return { ...failureResult(job.reason!, job.reason === 'timeout'), conversation: session.conversation };
        if (outcome.failure)
          return {
            ...failureResult(outcome.failure),
            conversation: session.conversation,
            ...(turn.providerFailure ? { providerFailure: turn.providerFailure } : {}),
          };
        const stdout = [
          { type: 'thread.started', thread_id: threadId },
          { type: 'turn.started' },
          { type: 'item.completed', item: { type: 'agent_message', text: outcome.output } },
          { type: 'turn.completed' },
        ]
          .map((event) => JSON.stringify(event))
          .join('\n');
        const result = decodeCodexConversationOutput(
          { exitCode: 0, stdout, stderr: '', timedOut: false },
          session.conversation,
        );
        if (result.exitCode === 0) session.outputDigest = digest(result.stdout);
        return {
          ...result,
          ...(turn.usage ? { persistentUsage: turn.usage } : {}),
          persistentMeasurements: measurements,
        };
      } finally {
        if (interruptTimer) clearTimeout(interruptTimer);
        job.controller.signal.removeEventListener('abort', interrupt);
        if (turn.id) {
          const history = retired.get(threadId) ?? new Set<string>();
          history.add(turn.id);
          retired.set(threadId, history);
          retiredTurnCount++;
        }
        turns.delete(threadId);
      }
    } catch (error) {
      if (error instanceof CodexTransportError) {
        current?.fail(error);
        await current?.close();
        return {
          ...failureResult(job.reason ?? error.reason, job.reason === 'timeout'),
          ...(error.rpcCode !== undefined ? { rpcCode: error.rpcCode } : {}),
          ...(session?.conversation ? { conversation: session.conversation } : {}),
        };
      }
      if (job.controller.signal.aborted)
        return {
          ...failureResult(job.reason!, job.reason === 'timeout'),
          ...(session?.conversation ? { conversation: session.conversation } : {}),
        };
      throw error;
    } finally {
      if (current && !current.alive) await current.close();
      if (timer) clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      if (session) session.active = false;
      busy.delete(assignment.id);
      jobs.delete(job);
      measurements.invocationElapsedMs = performance.now() - started;
      emit('run.measurements', { ...measurements, agent: 'codex', ...(persistentUsage ? { persistentUsage } : {}) });
      if (acquired) release();
      finish();
    }
  };

  return {
    invoke,
    checkAuth: checkAgentAuth,
    admit: (id, outputDigest, admissionDigest) => sessions.admit(id, outputDigest, admissionDigest),
    createHandoff: (id) => sessions.handoff(id),
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        for (const job of [...queue]) cancel(job, 'shutdown');
        const timer = setTimeout(() => {
          for (const job of jobs) cancel(job, 'shutdown');
          connection?.fail(new CodexTransportError('shutdown-drain-timeout'));
        }, drainTimeout);
        try {
          await Promise.all([...jobs].map((job) => job.finished));
          await connection?.close();
          const disposal = await Promise.allSettled(
            [...retainedArtifacts.values()].flat().map((artifact) => artifact.dispose()),
          );
          if (disposal.some((result) => result.status === 'rejected'))
            throw new Error('Persistent prompt artifact disposal failed');
        } finally {
          clearTimeout(timer);
          sessions.clear();
          retired.clear();
          retiredTurnCount = 0;
          retainedArtifacts.clear();
        }
      })();
      return closePromise;
    },
  };
}
