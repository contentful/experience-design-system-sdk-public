import { createHash, randomUUID } from 'node:crypto';
import {
  AGENT_CALL_MAX_ATTEMPTS,
  type AgentCallAttempt,
  type ExplorationIdentity,
} from '@contentful/experience-design-system-types';
import { abortableDelay, throwIfAborted } from '../../../helpers/abort.js';
import { writePhaseArtifact } from './write-phase-artifact.js';

export async function finalizePhaseArtifacts(options: {
  directory: string;
  identity: ExplorationIdentity;
  artifacts: ReadonlyArray<{ name: string; payload: unknown }>;
  loadAttempts: () => AgentCallAttempt[];
  onAttempt: (attempt: AgentCallAttempt) => void;
  assertCurrent: () => void;
  signal?: AbortSignal;
  maxAttempts?: number;
  timeoutMs: number;
  backoffMs?: number;
}): Promise<void> {
  const operationId = randomUUID();
  const limit = options.maxAttempts ?? AGENT_CALL_MAX_ATTEMPTS;
  const deadline = Date.now() + options.timeoutMs;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error('Invalid finalization attempt or timeout budget');
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeoutMs)]);
  for (let attempt = 1; attempt <= limit; attempt++) {
    const started = Date.now();
    let failure: unknown;
    try {
      throwIfAborted(signal);
      options.assertCurrent();
      for (const artifact of options.artifacts) {
        throwIfAborted(signal);
        await writePhaseArtifact(options.directory, artifact.name, artifact.payload, signal);
      }
      const attempts = options.loadAttempts();
      await writePhaseArtifact(
        options.directory,
        'manifest.json',
        {
          identity: options.identity,
          state: 'computed',
          publicationAuthority: 'session-database',
          artifacts: options.artifacts.map((artifact) => ({
            name: artifact.name,
            sha256: createHash('sha256')
              .update(JSON.stringify(artifact.payload, null, 2))
              .digest('hex'),
          })),
          stageAttempts: attempts.filter((receipt) => receipt.stage !== 'finalize'),
          previousFinalizationAttempts: attempts.filter((receipt) => receipt.stage === 'finalize'),
          finalization: { operationId, attempt },
        },
        signal,
      );
      throwIfAborted(signal);
      options.assertCurrent();
    } catch (error) {
      failure = error;
    }
    options.onAttempt({
      stage: 'finalize',
      operationId,
      attempt,
      ok: failure === undefined,
      identity: options.identity,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      ...(failure !== undefined ? { error: failure instanceof Error ? failure.message : String(failure) } : {}),
    });
    throwIfAborted(options.signal);
    if (failure === undefined) return;
    if (attempt === limit || Date.now() >= deadline || signal.aborted) throw failure;
    await abortableDelay(
      Math.min((options.backoffMs ?? 250) * 2 ** (attempt - 1), 5000, Math.max(0, deadline - Date.now())),
      options.signal,
    );
  }
}
