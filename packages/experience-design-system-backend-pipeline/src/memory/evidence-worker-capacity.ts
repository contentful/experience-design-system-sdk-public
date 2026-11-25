import { currentGenerationMemoryObservation, type GenerationMemoryObservation } from './generation-memory-mode.js';
import { performance } from 'node:perf_hooks';
import { createAbortError, throwIfAborted } from '../helpers/abort.js';
import { startImportProfileSpan, type ImportProfileAttributes } from '../profiling/import-profile.js';
import { ImportMemoryCapacityError } from './evidence-memory-errors.js';
import { currentEvidenceMemoryScope, type EvidenceMemoryWait } from './evidence-memory-scope.js';
import { DEFAULT_EVIDENCE_MEMORY_POLICY, type EvidenceMemoryPolicy } from './evidence-memory-policy.js';
export type { EvidenceMemoryPolicy } from './evidence-memory-policy.js';
export { ImportMemoryCapacityError } from './evidence-memory-errors.js';
export {
  estimateEvidenceMemory,
  createEvidenceMemoryEstimator,
  evidenceMemoryEstimator,
} from './evidence-memory-estimate.js';

export type EvidenceWorkKind = 'preparation' | 'validation';
export interface EvidenceMemoryRequest {
  process?: 'parent' | 'child';
  parentReservationBytes?: number;
  estimatedPeakBytes: number;
  queuedBytes: number;
  onWait?: (event: EvidenceMemoryWait) => void;
  independentRelease?: boolean;
}
export interface EvidenceMemoryLease {
  observeChildProcess(observation: { pid: number; rssBytes: number }): void;
  retainValidation(retainedBytes?: number): void;
  release(): void;
}

export function createEvidenceWorkerCapacity(
  input: EvidenceMemoryPolicy,
  rssBytes: () => number = process.memoryUsage.rss,
) {
  const policy = { ...input };
  for (const key of ['budgetBytes', 'reservationBytes', 'maxPreparing', 'maxQueuedJobs'] as const)
    if (!Number.isSafeInteger(policy[key]) || policy[key] <= 0) throw new Error('Invalid evidence memory policy');
  if (!Number.isFinite(policy.headroomFraction) || policy.headroomFraction < 0 || policy.headroomFraction >= 1)
    throw new Error('Invalid evidence memory headroom');
  const usableBytes = Math.floor(policy.budgetBytes * (1 - policy.headroomFraction));
  const maxQueuedBytes = policy.maxQueuedBytes ?? Math.max(1, Math.floor(usableBytes / 4));
  if (!Number.isSafeInteger(maxQueuedBytes) || maxQueuedBytes < 1)
    throw new Error('Invalid evidence queued byte limit');
  if (policy.reservationBytes > usableBytes)
    throw new ImportMemoryCapacityError('reservation-too-large', policy.budgetBytes, 0);
  let reservedBytes = 0;
  let retainedBytes = 0;
  let queuedBytes = 0;
  let preparing = 0;
  let retainedValidation = 0;
  let baselineRss = 0;
  let pumping = false;
  let repump = false;
  type Owner = {
    process: 'parent' | 'child';
    parentReservation: number;
    child?: { pid: number; rssBytes: number; peakRssBytes: number };
    scope?: symbol;
    independentRelease: boolean;
    observation?: GenerationMemoryObservation;
    preparing: boolean;
    reservation: number;
    retained?: number;
  };
  const owners = new Set<Owner>();
  const children = new Map<number, Owner>();
  type Waiting = {
    kind: EvidenceWorkKind;
    signal?: AbortSignal;
    scope?: symbol;
    request: EvidenceMemoryRequest;
    observers: ((event: EvidenceMemoryWait) => void)[];
    startedWaiting?: number;
    abort: () => void;
    resolve: (lease: EvidenceMemoryLease) => void;
    reject: (error: unknown) => void;
    profile: ReturnType<typeof startImportProfileSpan>;
    observation?: GenerationMemoryObservation;
  };
  const waiting: Waiting[] = [];
  const sample = () => {
    const value = rssBytes();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid process memory observation');
    return value;
  };
  const notify = (entry: Waiting, state: EvidenceMemoryWait['state']) => {
    if (state === 'waiting') {
      if (entry.startedWaiting !== undefined) return;
      entry.startedWaiting = performance.now();
    } else if (entry.startedWaiting === undefined) return;
    const event: EvidenceMemoryWait = {
      state,
      waitMs: Math.max(0, performance.now() - entry.startedWaiting!),
      estimatedPeakBytes: entry.request.estimatedPeakBytes,
      queuedBytes,
      reservedBytes,
      retainedBytes,
      budgetBytes: policy.budgetBytes,
    };
    for (const observer of entry.observers) {
      try {
        observer(event);
      } catch {}
    }
  };
  const remove = (entry: Waiting) => {
    const index = waiting.indexOf(entry);
    if (index >= 0) {
      waiting.splice(index, 1);
      queuedBytes -= entry.request.queuedBytes;
    }
    entry.signal?.removeEventListener('abort', entry.abort);
  };
  const fail = (entry: Waiting, error: unknown, cancelled = false) => {
    remove(entry);
    entry.profile.end(cancelled ? 'cancelled' : 'error');
    notify(entry, cancelled ? 'cancelled' : 'rejected');
    entry.reject(error);
  };
  const accounting = (rss: number) => {
    let modeledParentBytes = 0;
    let accountedChildBytes = 0;
    let observedChildRssBytes = 0;
    for (const owner of owners) {
      if (owner.process === 'child') {
        modeledParentBytes += owner.parentReservation;
        observedChildRssBytes += owner.child?.rssBytes ?? 0;
        accountedChildBytes += Math.max(owner.reservation + (owner.retained ?? 0), owner.child?.peakRssBytes ?? 0);
      } else modeledParentBytes += owner.reservation + (owner.retained ?? 0);
    }
    return {
      modeledParentBytes,
      accountedChildBytes,
      observedChildRssBytes,
      aggregateRssBytes: rss + observedChildRssBytes,
      accountedBytes: Math.max(rss, baselineRss + modeledParentBytes) + accountedChildBytes,
    };
  };
  const predictedBytes = (rss: number, request: EvidenceMemoryRequest) => {
    const current = accounting(rss);
    const parentReservation =
      request.process === 'child' ? (request.parentReservationBytes ?? 0) : request.estimatedPeakBytes;
    const childReservation = request.process === 'child' ? request.estimatedPeakBytes : 0;
    return (
      Math.max(rss + parentReservation, baselineRss + current.modeledParentBytes + parentReservation) +
      current.accountedChildBytes +
      childReservation
    );
  };
  const canRelease = (entry: Waiting, preparationBlocked: boolean) => {
    const blockedScopes = new Set(waiting.map((job) => job.scope).filter((scope) => scope !== undefined));
    return [...owners].some(
      (owner) =>
        (!preparationBlocked || owner.preparing) &&
        (owner.independentRelease ||
          owner.scope === undefined ||
          (owner.scope !== entry.scope && !blockedScopes.has(owner.scope))),
    );
  };
  const pump = () => {
    if (pumping) {
      repump = true;
      return;
    }
    pumping = true;
    try {
      while (waiting.length) {
        const entry = waiting.find((job) => job.observation) ?? waiting[0]!;
        if (entry.signal?.aborted) {
          fail(entry, createAbortError(entry.signal.reason), true);
          continue;
        }
        let rss: number;
        try {
          rss = sample();
        } catch (error) {
          fail(entry, error);
          continue;
        }
        const preparationBlocked = entry.kind === 'preparation' && preparing >= policy.maxPreparing;
        const predicted = predictedBytes(rss, entry.request);
        if (preparationBlocked)
          entry.observation?.observe({
            bound: 'preparing',
            scope: 'admission',
            observedCount: preparing + 1,
            limitCount: policy.maxPreparing,
            estimatedBytes: predicted,
            limitBytes: usableBytes,
          });
        if (predicted > usableBytes)
          entry.observation?.observe({
            bound: 'aggregate-pressure',
            scope: 'admission',
            observedBytes: accounting(rss).aggregateRssBytes,
            estimatedBytes: predicted,
            limitBytes: usableBytes,
          });
        if (!entry.observation && (preparationBlocked || predicted > usableBytes)) {
          if (canRelease(entry, preparationBlocked)) {
            for (const queued of waiting) notify(queued, 'waiting');
            return;
          }
          fail(
            entry,
            new ImportMemoryCapacityError(
              owners.size ? 'dependency-wait' : 'idle-pressure',
              policy.budgetBytes,
              accounting(rss).aggregateRssBytes,
            ),
          );
          continue;
        }
        remove(entry);
        if (owners.size === 0) baselineRss = rss;
        const owner: Owner = {
          process: entry.request.process ?? 'parent',
          parentReservation: entry.request.parentReservationBytes ?? 0,
          scope: entry.scope,
          observation: entry.observation,
          independentRelease: entry.request.independentRelease ?? false,
          preparing: entry.kind === 'preparation',
          reservation: entry.request.estimatedPeakBytes,
        };
        owners.add(owner);
        if (owner.preparing) preparing++;
        reservedBytes += owner.reservation + owner.parentReservation;
        entry.profile.end();
        notify(entry, 'admitted');
        let released = false;
        entry.resolve({
          observeChildProcess: ({ pid, rssBytes: observed }) => {
            if (released) throw new Error('Child observation lease already released');
            if (owner.process !== 'child') throw new Error('Child observations require a child process grant');
            if (
              !Number.isSafeInteger(pid) ||
              pid <= 0 ||
              pid === process.pid ||
              !Number.isSafeInteger(observed) ||
              observed < 0
            )
              throw new Error('Invalid child process memory observation');
            if (owner.child && owner.child.pid !== pid) throw new Error('Changed child process identity');
            const existing = children.get(pid);
            if (existing && existing !== owner) throw new Error('Child process already owned by another lease');
            const current = accounting(sample());
            const peakRssBytes = Math.max(owner.child?.peakRssBytes ?? 0, observed);
            const previousAccounted = Math.max(
              owner.reservation + (owner.retained ?? 0),
              owner.child?.peakRssBytes ?? 0,
            );
            const nextAccounted = Math.max(owner.reservation + (owner.retained ?? 0), peakRssBytes);
            if (
              !Number.isSafeInteger(current.aggregateRssBytes - (owner.child?.rssBytes ?? 0) + observed) ||
              !Number.isSafeInteger(current.accountedBytes - previousAccounted + nextAccounted)
            )
              throw new Error('Invalid aggregate child memory observation');
            owner.child = { pid, rssBytes: observed, peakRssBytes };
            children.set(pid, owner);
            const next = accounting(sample());
            if (next.accountedBytes > usableBytes)
              owner.observation?.observe({
                bound: 'aggregate-pressure',
                scope: 'process',
                observedBytes: next.aggregateRssBytes,
                estimatedBytes: next.accountedBytes,
                limitBytes: usableBytes,
              });
            pump();
          },
          retainValidation: (bytes = 0) => {
            if (released || owner.retained !== undefined) return;
            if (!Number.isSafeInteger(bytes) || bytes < 0)
              throw new Error('Invalid retained evidence byte observation');
            owner.retained = owner.process === 'child' ? Math.max(bytes, owner.reservation) : bytes;
            owner.independentRelease = false;
            retainedValidation++;
            retainedBytes += owner.retained;
            if (owner.preparing) {
              preparing--;
              owner.preparing = false;
            }
            reservedBytes -= owner.reservation;
            owner.reservation = 0;
            pump();
          },
          release: () => {
            if (released) return;
            released = true;
            owners.delete(owner);
            if (owner.child) children.delete(owner.child.pid);
            if (owner.preparing) preparing--;
            if (owner.retained !== undefined) {
              retainedValidation--;
              retainedBytes -= owner.retained;
            }
            reservedBytes -= owner.reservation + owner.parentReservation;
            if (owners.size === 0) baselineRss = 0;
            pump();
          },
        });
      }
    } finally {
      pumping = false;
      if (repump) {
        repump = false;
        pump();
      }
    }
  };
  return {
    acquire: async (
      kind: EvidenceWorkKind,
      signal?: AbortSignal,
      attributes?: ImportProfileAttributes,
      request: EvidenceMemoryRequest = { estimatedPeakBytes: policy.reservationBytes, queuedBytes: 0 },
    ): Promise<EvidenceMemoryLease> => {
      throwIfAborted(signal);
      if (kind !== 'preparation' && kind !== 'validation') throw new Error('Invalid evidence work kind');
      if (
        !Number.isSafeInteger(request.estimatedPeakBytes) ||
        request.estimatedPeakBytes <= 0 ||
        !Number.isSafeInteger(request.queuedBytes) ||
        request.queuedBytes < 0 ||
        (request.process !== undefined && request.process !== 'parent' && request.process !== 'child') ||
        !Number.isSafeInteger(request.parentReservationBytes ?? 0) ||
        (request.parentReservationBytes ?? 0) < 0 ||
        (request.process !== 'child' && (request.parentReservationBytes ?? 0) !== 0)
      )
        throw new Error('Invalid evidence memory estimate');
      const observation = currentGenerationMemoryObservation();
      const reservation = request.estimatedPeakBytes + (request.parentReservationBytes ?? 0);
      if (reservation > usableBytes)
        observation?.observe({
          bound: 'reservation',
          scope: 'admission',
          estimatedBytes: reservation,
          limitBytes: usableBytes,
        });
      if (!observation && reservation > usableBytes)
        throw new ImportMemoryCapacityError(
          'reservation-too-large',
          policy.budgetBytes,
          accounting(sample()).aggregateRssBytes,
        );
      if (waiting.length >= policy.maxQueuedJobs)
        observation?.observe({
          bound: 'queue-jobs',
          scope: 'admission',
          observedCount: waiting.length + 1,
          limitCount: policy.maxQueuedJobs,
        });
      if (!observation && waiting.length >= policy.maxQueuedJobs)
        throw new ImportMemoryCapacityError('queue-full', policy.budgetBytes, accounting(sample()).aggregateRssBytes);
      const rss = sample();
      const queues =
        waiting.length > 0 ||
        (kind === 'preparation' && preparing >= policy.maxPreparing) ||
        predictedBytes(rss, request) > usableBytes;
      if (queues && queuedBytes + request.queuedBytes > maxQueuedBytes)
        observation?.observe({
          bound: 'queue-bytes',
          scope: 'admission',
          estimatedBytes: queuedBytes + request.queuedBytes,
          limitBytes: maxQueuedBytes,
        });
      if (!observation && queues && queuedBytes + request.queuedBytes > maxQueuedBytes)
        throw new ImportMemoryCapacityError('queue-bytes-full', policy.budgetBytes, accounting(rss).aggregateRssBytes);
      const scope = currentEvidenceMemoryScope();
      return new Promise((resolve, reject) => {
        const entry: Waiting = {
          kind,
          signal,
          observation,
          request: { ...request },
          scope: scope?.owner,
          observers: [request.onWait, scope?.onWait].filter((observer) => observer !== undefined),
          resolve,
          reject,
          profile: startImportProfileSpan('evidence.memoryWait', { ...attributes, workerRole: kind }),
          abort: () => {
            fail(entry, createAbortError(signal?.reason), true);
            pump();
          },
        };
        waiting.push(entry);
        queuedBytes += request.queuedBytes;
        signal?.addEventListener('abort', entry.abort, { once: true });
        if (signal?.aborted) entry.abort();
        else pump();
      });
    },
    stats: () => ({
      active: owners.size,
      preparing,
      retainedValidation,
      waiting: waiting.length,
      reservedBytes,
      retainedBytes,
      queuedBytes,
      maxQueuedBytes,
      budgetBytes: policy.budgetBytes,
      usableBytes,
      childProcesses: children.size,
      ...accounting(sample()),
    }),
  };
}

export const evidenceWorkerCapacity = createEvidenceWorkerCapacity(DEFAULT_EVIDENCE_MEMORY_POLICY);
