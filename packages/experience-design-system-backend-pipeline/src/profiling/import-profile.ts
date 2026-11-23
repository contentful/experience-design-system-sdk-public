import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { threadId } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';
import { getPipelineDbPath } from '../persistence/src/session/helpers/pipeline-db-path.js';

export type ImportProfileStatus = 'success' | 'error' | 'cancelled' | 'interrupted';
export interface ImportProfileAttributes {
  agent?: string;
  stage?: string;
  step?: string;
  task?: string;
  component?: string;
  attempt?: number;
  operationId?: string;
  workerRole?: string;
  componentCount?: number;
  fileCount?: number;
  evidenceBytes?: number;
  inputBytes?: number;
  parsedBytes?: number;
  transferBytes?: number;
  residentBytes?: number;
  budgetBytes?: number;
  reservedBytes?: number;
  recordCount?: number;
  activeRequests?: number;
  receiveMs?: number;
  compilerContextCount?: number;
}
export const importWorkMetrics = [
  'catalogAdmissionMs',
  'catalogAdmissionChecks',
  'derivedDecodeMs',
  'derivedLookupMs',
  'derivedTreeReads',
  'derivedTreeCacheHits',
  'valueAccessMs',
  'sqliteWriteMs',
  'fileWriteMs',
  'sortMs',
  'utf8EncodeMs',
  'valueReads',
  'encodedObjects',
  'encodedArrays',
  'duplicateRecords',
  'fragmentWrites',
  'indexLookupMs',
  'fileReadMs',
  'recordDecodeMs',
  'recordHashMs',
  'jsonEncodeMs',
  'logicalHashMs',
  'sqlReadMs',
  'decodeMs',
  'tokenScanMs',
  'traversalMs',
  'bookkeepingMs',
  'recordSetupMs',
  'recordValidationMs',
  'accessMetricsMs',
  'otherMs',
  'readCalls',
  'readBytes',
  'recordCount',
  'recordVisits',
  'recordCacheHits',
  'recordCacheMisses',
  'recordCacheAdmissions',
  'recordCacheBytes',
  'recordFrequencyBytes',
  'recordCachePendingBytes',
  'lookupCount',
  'parsedEntries',
  'hashedBytes',
  'hashUpdates',
  'encodedValues',
] as const;
export type ImportWorkMetric = (typeof importWorkMetrics)[number];
export type ImportWorkMeasurements = Partial<Record<ImportWorkMetric, number>>;
export interface ImportProfileSpan {
  readonly id?: string;
  end: (status?: ImportProfileStatus, work?: ImportWorkMeasurements) => void;
}

export interface ImportProfileActivity {
  name: string;
  status: 'running' | ImportProfileStatus;
  elapsedMs: number;
}
const profileDirectory = new AsyncLocalStorage<{
  directory: string;
  onSpan?: (event: ImportProfileActivity) => void;
}>();
export function withImportProfileDirectory<T>(
  directory: string,
  action: () => T,
  onSpan?: (event: ImportProfileActivity) => void,
): T {
  return profileDirectory.run({ directory, onSpan }, action);
}
export function importProfileDirectory(): string | undefined {
  if (process.env.EDS_IMPORT_EXPERIMENTAL === '0' && !process.env.EDS_IMPORT_PROFILE_DIR) return undefined;
  return (
    process.env.EDS_IMPORT_PROFILE_DIR ??
    profileDirectory.getStore()?.directory ??
    join(dirname(getPipelineDbPath()), 'import-diagnostics')
  );
}

const parentSpan = new AsyncLocalStorage<string>();
const disabledSpan: ImportProfileSpan = { end: () => {} };
let preparedDirectory: string | undefined;

function threadCpu(): NodeJS.CpuUsage | null {
  try {
    return typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : null;
  } catch {
    return null;
  }
}

function memory(): {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBufferBytes: number;
  heapLimitBytes: number;
} {
  const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  return {
    rssBytes: rss,
    heapUsedBytes: heapUsed,
    heapTotalBytes: heapTotal,
    externalBytes: external,
    arrayBufferBytes: arrayBuffers,
    heapLimitBytes: getHeapStatistics().heap_size_limit,
  };
}

const threadMemoryKeys = ['heapUsedBytes', 'heapTotalBytes', 'externalBytes', 'arrayBufferBytes'] as const;
type ThreadMemory = Pick<ReturnType<typeof memory>, (typeof threadMemoryKeys)[number]>;
interface MemoryObservations {
  peakThreadMemory: ThreadMemory;
  sampling: { intervalMs: number; periodicSamples: number; failures: number };
}
const activeObservations = new Set<MemoryObservations>();
let sampler: ReturnType<typeof setInterval> | undefined;
let samplerIntervalMs = 250;

function observePeak(observations: MemoryObservations, current: ReturnType<typeof memory>): void {
  for (const key of threadMemoryKeys)
    observations.peakThreadMemory[key] = Math.max(observations.peakThreadMemory[key], current[key]);
}

function beginObservations(initial: ReturnType<typeof memory>): MemoryObservations {
  if (!sampler) {
    const requested = Number(process.env.EDS_IMPORT_PROFILE_SAMPLE_INTERVAL_MS);
    samplerIntervalMs = Number.isSafeInteger(requested) && requested >= 10 && requested <= 60000 ? requested : 250;
    sampler = setInterval(() => {
      try {
        const current = memory();
        for (const observations of activeObservations) {
          observePeak(observations, current);
          observations.sampling.periodicSamples++;
        }
      } catch {
        for (const observations of activeObservations) observations.sampling.failures++;
      }
    }, samplerIntervalMs);
    sampler.unref();
  }
  const observations = {
    peakThreadMemory: Object.fromEntries(threadMemoryKeys.map((key) => [key, initial[key]])) as ThreadMemory,
    sampling: { intervalMs: samplerIntervalMs, periodicSamples: 0, failures: 0 },
  };
  activeObservations.add(observations);
  return observations;
}

function endObservations(observations: MemoryObservations): void {
  activeObservations.delete(observations);
  if (!activeObservations.size && sampler) {
    clearInterval(sampler);
    sampler = undefined;
  }
}

function writeEvent(directory: string, event: Record<string, unknown>): void {
  if (preparedDirectory !== directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    preparedDirectory = directory;
  }
  appendFileSync(join(directory, `spans.${process.pid}.${threadId}.jsonl`), `${JSON.stringify(event)}\n`, {
    mode: 0o600,
  });
}

export function startImportProfileSpan(name: string, attributes: ImportProfileAttributes = {}): ImportProfileSpan {
  const directory = importProfileDirectory();
  const listener = profileDirectory.getStore()?.onSpan;
  const activityStarted = listener ? performance.now() : 0;
  let activityEnded = false;
  const notify = (status: 'running' | ImportProfileStatus) => {
    if (status !== 'running') {
      if (activityEnded) return;
      activityEnded = true;
    }
    try {
      listener?.({ name, status, elapsedMs: Math.max(0, performance.now() - activityStarted) });
    } catch {}
  };
  if (listener) notify('running');
  const fallback = listener ? { end: (status: ImportProfileStatus = 'success') => notify(status) } : disabledSpan;
  if (!directory) return fallback;
  try {
    const started = performance.now();
    const startedAtMs = performance.timeOrigin + started;
    const processCpu = process.cpuUsage();
    const ownCpu = threadCpu();
    const id = randomUUID();
    const metadata = Object.fromEntries(
      ['agent', 'stage', 'step', 'task', 'component', 'attempt', 'operationId', 'workerRole']
        .filter((key) => attributes[key as keyof ImportProfileAttributes] !== undefined)
        .map((key) => [key, attributes[key as keyof ImportProfileAttributes]]),
    );
    for (const key of [
      'componentCount',
      'fileCount',
      'evidenceBytes',
      'inputBytes',
      'parsedBytes',
      'transferBytes',
      'residentBytes',
      'budgetBytes',
      'reservedBytes',
      'recordCount',
      'activeRequests',
      'receiveMs',
      'compilerContextCount',
    ] as const) {
      const value = attributes[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) metadata[key] = value;
    }
    const identity = {
      schemaVersion: 1,
      id,
      ...(parentSpan.getStore() ? { parentId: parentSpan.getStore() } : {}),
      name,
      pid: process.pid,
      threadId,
      attributes: metadata,
      memoryScopes: { rss: 'process', heap: 'thread', external: 'thread', arrayBuffers: 'thread' },
    };
    const initialMemory = memory();
    writeEvent(directory, { ...identity, type: 'span-start', timestampMs: startedAtMs, memory: initialMemory });
    const observations = beginObservations(initialMemory);
    let ended = false;
    return {
      id,
      end(status = 'success', work) {
        if (ended) return;
        ended = true;
        if (listener) notify(status);
        endObservations(observations);
        try {
          const wallMs = Math.max(0, performance.now() - started);
          const current = process.cpuUsage(processCpu);
          const ownCurrent = threadCpu();
          const currentMemory = memory();
          observePeak(observations, currentMemory);
          writeEvent(directory, {
            ...identity,
            type: 'span-end',
            timestampMs: startedAtMs + wallMs,
            wallMs,
            status,
            ...(work
              ? {
                  work: Object.fromEntries(
                    importWorkMetrics
                      .filter((key) => typeof work[key] === 'number' && Number.isFinite(work[key]) && work[key]! >= 0)
                      .map((key) => [key, work[key]]),
                  ),
                }
              : {}),
            processCpuMs: (current.user + current.system) / 1000,
            threadCpuMs:
              ownCpu && ownCurrent
                ? Math.max(0, ownCurrent.user + ownCurrent.system - ownCpu.user - ownCpu.system) / 1000
                : null,
            memory: currentMemory,
            peakThreadMemory: observations.peakThreadMemory,
            sampling: observations.sampling,
            boundaryMemoryDelta: Object.fromEntries(
              threadMemoryKeys.map((key) => [key, currentMemory[key] - initialMemory[key]]),
            ),
          });
        } catch {}
      },
    };
  } catch {
    return fallback;
  }
}

function failureStatus(error: unknown): ImportProfileStatus {
  return error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error';
}

export function profileImportSync<T>(name: string, action: () => T, attributes?: ImportProfileAttributes): T {
  const span = startImportProfileSpan(name, attributes);
  try {
    const value = span.id ? parentSpan.run(span.id, action) : action();
    span.end();
    return value;
  } catch (error) {
    span.end(failureStatus(error));
    throw error;
  }
}

export async function profileImportAsync<T>(
  name: string,
  action: () => Promise<T>,
  attributes?: ImportProfileAttributes,
): Promise<T> {
  const span = startImportProfileSpan(name, attributes);
  try {
    const value = await (span.id ? parentSpan.run(span.id, action) : action());
    span.end();
    return value;
  } catch (error) {
    span.end(failureStatus(error));
    throw error;
  }
}
