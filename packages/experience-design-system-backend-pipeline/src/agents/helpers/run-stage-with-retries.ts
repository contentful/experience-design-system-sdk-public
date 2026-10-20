import type { AgentCallAttempt } from '@contentful/experience-design-system-types';
import { randomUUID } from 'node:crypto';
import { AGENT_CALL_MAX_ATTEMPTS } from '@contentful/experience-design-system-types';
import { abortableDelay, throwIfAborted } from '../../helpers/abort.js';
import type { StageOptions } from '../../steps/exploration/src/types.js';
export async function runStageWithRetries<T>(
  options: StageOptions,
  stage: string,
  prompt: () => Promise<string>,
  parse: (output: string) => T,
  complete?: (value: T, attempts: AgentCallAttempt[]) => void | Promise<void>,
): Promise<
  { ok: true; value: T; attempts: AgentCallAttempt[] } | { ok: false; error: string; attempts: AgentCallAttempt[] }
> {
  const attempts: AgentCallAttempt[] = [];
  const operationId = randomUUID();
  const limit = options.maxAttempts ?? AGENT_CALL_MAX_ATTEMPTS;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error('Invalid stage attempt or timeout budget');
  const duration = options.operationTimeoutMs ?? options.timeoutMs * limit;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid operation deadline');
  const deadline = Date.now() + duration;
  for (let attempt = 1; attempt <= limit; attempt++) {
    throwIfAborted(options.signal);
    const started = Date.now();
    let value: T | undefined;
    let failure: string | undefined;
    try {
      const text = await prompt();
      throwIfAborted(options.signal);
      if (Buffer.byteLength(text, 'utf8') > (options.maxPromptBytes ?? 256 * 1024))
        throw new Error('Complete stage prompt exceeds byte bound');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Stage operation deadline exhausted');
      const result = await options.invoker.invoke({
        agent: options.agent,
        model: options.model,
        bedrock: options.bedrock,
        prompt: text,
        timeoutMs: Math.min(options.timeoutMs, remaining),
        signal: options.signal,
      });
      throwIfAborted(options.signal);
      if (result.timedOut || result.exitCode !== 0)
        throw new Error(result.timedOut ? 'Stage invocation timed out' : 'Stage invocation failed');
      if (Date.now() >= deadline) throw new Error('Stage operation deadline exhausted');
      value = parse(result.stdout);
      throwIfAborted(options.signal);
      if (Date.now() >= deadline) throw new Error('Stage operation deadline exhausted');
      if (complete)
        await complete(value, [
          ...attempts,
          {
            attempt,
            ok: true,
            stage,
            operationId,
            workIds: options.workIds,
            component: options.component,
            source: options.source,
            identity: options.identity,
            startedAt: new Date(started).toISOString(),
            durationMs: Date.now() - started,
          },
        ]);
      throwIfAborted(options.signal);
      if (Date.now() >= deadline) throw new Error('Stage operation deadline exhausted');
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const receipt: AgentCallAttempt = {
      attempt,
      ok: failure === undefined,
      stage,
      operationId,
      workIds: options.workIds,
      component: options.component,
      source: options.source,
      ...(options.identity ? { identity: options.identity } : {}),
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      ...(failure ? { error: failure } : {}),
    };
    attempts.push(receipt);
    await options.onAttempt?.(receipt);
    throwIfAborted(options.signal);
    if (failure === undefined) return { ok: true, value: value!, attempts };
    if (attempt === limit || Date.now() >= deadline) return { ok: false, error: failure, attempts };
    const base = options.backoffMs ?? 250;
    const delay = Math.min(base * 2 ** (attempt - 1), 5000, Math.max(0, deadline - Date.now()));
    await abortableDelay(delay, options.signal);
  }
  throw new Error('Stage attempt budget exhausted');
}
