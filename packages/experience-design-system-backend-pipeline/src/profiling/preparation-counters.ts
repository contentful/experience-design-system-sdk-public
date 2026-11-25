import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { threadId } from 'node:worker_threads';

const counterNames = [
  'ownerReads',
  'ownerReadCompletions',
  'ownersCompleted',
  'sourceOpens',
  'sourceOpenCompletions',
  'sourceReuses',
  'sourceBoundaryChecks',
  'authorityChecks',
  'digestPasses',
  'digestCompletions',
  'digestFragments',
  'catalogReuses',
  'verificationReuses',
  'catalogBuilds',
  'catalogCompletions',
  'catalogRecords',
  'fileReads',
  'fileCacheHits',
  'fileCacheMisses',
  'residentEvictions',
  'omissionScans',
] as const;
type CounterName = (typeof counterNames)[number];
type OwnerPhase = 'inventory' | 'component-encoding' | 'evidence-encoding';
interface PreparationState {
  counters: Record<CounterName, number>;
  owner?: { ordinal: number; total: number; name: string; phase: OwnerPhase };
  operation: string;
  started: number;
  lastWrite: number;
  lastActivity: number;
  ticks: number;
  file: string;
  sessionId: string;
  onActivity?: (activity: string) => void;
}
const active = new AsyncLocalStorage<PreparationState>();
const PUBLISH_THROTTLE_MS = 5000;

function publish(state: PreparationState, event: string, force = false): void {
  const now = performance.now();
  if (!force && now - state.lastWrite < PUBLISH_THROTTLE_MS) return;
  state.lastWrite = now;
  try {
    appendFileSync(
      state.file,
      `${JSON.stringify({
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        pid: process.pid,
        threadId,
        sessionId: state.sessionId,
        event,
        elapsedMs: now - state.started,
        operation: state.operation,
        owner: state.owner,
        counters: state.counters,
      })}\n`,
      { mode: 0o600 },
    );
  } catch {}
  try {
    const owner = state.owner;
    if (now - state.lastActivity < PUBLISH_THROTTLE_MS && !['start', 'complete', 'failed', 'cancelled'].includes(event))
      return;
    state.lastActivity = now;
    state.onActivity?.(
      `Evidence preparation · ${owner ? `${owner.name} ${owner.ordinal}/${owner.total} · ${owner.phase} · ` : ''}${state.operation}` +
        ` · ${state.counters.ownersCompleted} owners checked · ${state.counters.sourceOpens} source opens` +
        ` · ${state.counters.digestPasses} digest passes · ${state.counters.fileReads} file reads`,
    );
  } catch {}
}

export function withPreparationCounters<T>(
  options: { directory: string; sessionId: string; onActivity?: (activity: string) => void },
  action: () => T,
): T {
  let state: PreparationState;
  try {
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    state = {
      counters: Object.fromEntries(counterNames.map((name) => [name, 0])) as Record<CounterName, number>,
      operation: 'selection-evidence',
      started: performance.now(),
      lastWrite: -Infinity,
      lastActivity: -Infinity,
      ticks: 0,
      file: join(options.directory, `preparation.${process.pid}.${threadId}.${randomUUID()}.jsonl`),
      sessionId: options.sessionId,
      onActivity: options.onActivity,
    };
  } catch {
    return action();
  }
  return active.run(state, () => {
    publish(state, 'start', true);
    try {
      const result = action();
      publish(state, 'complete', true);
      return result;
    } catch (error) {
      publish(state, error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed', true);
      throw error;
    }
  });
}

export function countPreparation(name: CounterName, amount = 1): void {
  const state = active.getStore();
  if (!state) return;
  state.counters[name] += amount;
  state.ticks += amount;
  if (state.ticks >= 1024) {
    state.ticks = 0;
    publish(state, 'progress');
  }
}

export function preparationOperation<T>(operation: string, action: () => T): T {
  const state = active.getStore();
  if (!state) return action();
  const previous = state.operation;
  state.operation = operation;
  publish(state, 'operation-start', true);
  try {
    const result = action();
    publish(state, 'operation-complete', true);
    return result;
  } catch (error) {
    publish(state, 'operation-failed', true);
    throw error;
  } finally {
    state.operation = previous;
  }
}

export function preparationOwnerRead<T>(
  owner: { ordinal: number; total: number; name: string; phase: OwnerPhase },
  action: () => T,
): T {
  const state = active.getStore();
  if (!state) return action();
  const previous = state.owner;
  state.owner = owner;
  countPreparation('ownerReads');
  try {
    return preparationOperation('owner-read', () => {
      const result = action();
      countPreparation('ownerReadCompletions');
      return result;
    });
  } finally {
    state.owner = previous;
  }
}
