import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import { importProfileDirectory } from '../profiling/import-profile.js';

export interface GenerationMemoryBound {
  bound:
    | 'measurement-nodes'
    | 'measurement-entries'
    | 'measurement-depth'
    | 'transport-bytes'
    | 'transport-graph'
    | 'transport-nodes'
    | 'transport-entries'
    | 'transport-depth'
    | 'parent-pressure'
    | 'child-pressure'
    | 'reservation'
    | 'queue-jobs'
    | 'queue-bytes'
    | 'preparing'
    | 'aggregate-pressure';
  scope: 'request' | 'result' | 'estimate' | 'admission' | 'process';
  operation?: string;
  observedBytes?: number;
  estimatedBytes?: number;
  limitBytes?: number;
  observedCount?: number;
  limitCount?: number;
}
export interface GenerationMemoryObservation {
  observe: (event: GenerationMemoryBound) => void;
}
const observations = new AsyncLocalStorage<GenerationMemoryObservation | undefined>();
export const currentGenerationMemoryObservation = (): GenerationMemoryObservation | undefined =>
  observations.getStore();
export const isGenerationMemoryObservation = (): boolean => observations.getStore() !== undefined;

export function withGenerationMemoryObservation<T>(action: () => T, observation?: GenerationMemoryObservation): T {
  if (observations.getStore()) return action();
  if (observation) return observations.run(observation, action);
  const reported = new Set<string>();
  return observations.run(
    {
      observe(event) {
        const operation =
          event.operation && /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(event.operation) ? event.operation : 'generation';
        const key = `${event.bound}:${event.scope}:${operation}`;
        if (reported.has(key) || reported.size >= 128) return;
        reported.add(key);
        const numeric = Object.fromEntries(
          (['observedBytes', 'estimatedBytes', 'limitBytes', 'observedCount', 'limitCount'] as const)
            .filter((field) => Number.isFinite(event[field]) && event[field]! >= 0)
            .map((field) => [field, event[field]]),
        );
        const record =
          JSON.stringify({
            type: 'generation-memory-bound-exceeded',
            schemaVersion: 1,
            timestampMs: Date.now(),
            pid: process.pid,
            threadId,
            mode: 'observation',
            bound: event.bound,
            scope: event.scope,
            operation,
            ...numeric,
          }) + '\n';
        try {
          const directory = importProfileDirectory();
          if (directory) {
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            appendFileSync(join(directory, `memory-bounds.${process.pid}.${threadId}.jsonl`), record, { mode: 0o600 });
          } else process.stderr.write(record);
        } catch {}
      },
    },
    action,
  );
}

export function observeGenerationMemoryBound(event: GenerationMemoryBound): boolean {
  const observation = observations.getStore();
  observation?.observe(event);
  return observation !== undefined;
}

export function withBoundedEvidenceMemory<T>(action: () => T): T {
  return observations.run(undefined, action);
}
export function withImportWorkerMemoryPolicy<T>(kind: string, action: () => T): T {
  return ['detail', 'generate', 'mapTokens'].includes(kind)
    ? withGenerationMemoryObservation(action)
    : withBoundedEvidenceMemory(action);
}
export function isExtractionSourceOperation(kind: string): boolean {
  return [
    'extractAndComposeImport',
    'extract',
    'capture',
    'composition',
    'storeExtraction',
    'publishExtraction',
  ].includes(kind);
}

export function bindGenerationMemoryObservation<T extends (...args: never[]) => unknown>(callback: T): T {
  return observations.getStore() ? AsyncLocalStorage.bind(callback) : callback;
}
