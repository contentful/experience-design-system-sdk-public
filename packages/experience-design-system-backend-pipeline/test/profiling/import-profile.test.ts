import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  importProfileDirectory,
  profileImportAsync,
  profileImportSync,
  startImportProfileSpan,
  withImportProfileDirectory,
} from '../../src/profiling/import-profile.js';

let directory: string;
const events = (location = directory): any[] =>
  readdirSync(location)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) =>
      readFileSync(join(location, name), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    );

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'import-profile-spans-'));
  vi.stubEnv('EDS_IMPORT_PROFILE_DIR', directory);
  vi.stubEnv('EDS_HOME', join(directory, 'default'));
  vi.stubEnv('EDS_PIPELINE_DB_PATH', undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe('import profiling spans', () => {
  it('records a start immediately and ends only once with wall, CPU and memory measurements', () => {
    const span = startImportProfileSpan('source-analysis.task', { task: 'extract' });
    expect(events()).toMatchObject([
      { type: 'span-start', name: 'source-analysis.task', attributes: { task: 'extract' } },
    ]);
    const until = performance.now() + 20;
    while (performance.now() < until) Math.sqrt(performance.now());
    span.end();
    span.end('error');
    const [start, end] = events();
    expect(end).toMatchObject({ type: 'span-end', id: start.id, pid: process.pid, status: 'success' });
    expect(end.wallMs).toBeGreaterThanOrEqual(20);
    expect(end.processCpuMs).toBeGreaterThan(0);
    expect(end.threadCpuMs).toBeGreaterThan(0);
    expect(end.memory.rssBytes).toBeGreaterThan(0);
    expect(end.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(end.memory.heapLimitBytes).toBeGreaterThan(end.memory.heapUsedBytes);
    expect(end.memory.arrayBufferBytes).toBeGreaterThanOrEqual(0);
    expect(end.memoryScopes).toEqual({ rss: 'process', heap: 'thread', external: 'thread', arrayBuffers: 'thread' });
    expect(events()).toHaveLength(2);
  });

  it('preserves sync and async results and records failures without their private messages', async () => {
    expect(profileImportSync('sync', () => 42)).toBe(42);
    expect(await profileImportAsync('async', async () => 'done')).toBe('done');
    const error = new Error('private error detail');
    expect(() =>
      profileImportSync('failed', () => {
        throw error;
      }),
    ).toThrow(error);
    await expect(
      profileImportAsync('aborted', async () => {
        throw Object.assign(error, { name: 'AbortError' });
      }),
    ).rejects.toBe(error);
    expect(
      events()
        .filter((event) => event.type === 'span-end')
        .map((event) => event.status),
    ).toEqual(['success', 'success', 'error', 'cancelled']);
    expect(JSON.stringify(events())).not.toContain('private error detail');
  });

  it('does no profiling work when disabled and preserves the operation', async () => {
    vi.useFakeTimers();
    const readMemory = vi.spyOn(process, 'memoryUsage');
    vi.stubEnv('EDS_IMPORT_PROFILE_DIR', '');
    const span = startImportProfileSpan('disabled');
    span.end();
    expect(profileImportSync('sync', () => 42)).toBe(42);
    expect(await profileImportAsync('async', async () => 'done')).toBe('done');
    expect(readdirSync(directory)).toEqual([]);
    expect(readMemory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not fail an operation when the artifact directory cannot be written', async () => {
    const file = join(directory, 'file');
    writeFileSync(file, 'not a directory');
    vi.stubEnv('EDS_IMPORT_PROFILE_DIR', file);
    expect(profileImportSync('sync', () => 42)).toBe(42);
    expect(await profileImportAsync('async', async () => 'done')).toBe('done');
    expect(() =>
      profileImportSync('failure', () => {
        throw new Error('original');
      }),
    ).toThrow('original');
    expect(readdirSync(directory)).toEqual(['file']);
  });

  it('records only permitted metadata, even when given extra runtime fields', () => {
    const span = startImportProfileSpan('agent.validation', {
      stage: 'judge',
      attempt: 2,
      prompt: 'private prompt',
      cma_token: 'private token',
    } as any);
    span.end();
    expect(events()[0].attributes).toEqual({ stage: 'judge', attempt: 2 });
    expect(JSON.stringify(events())).not.toContain('private');
  });

  it('records bounded resource counters without serializing caller objects or invalid numbers', () => {
    const span = startImportProfileSpan('evidence.preparation', {
      workerRole: 'indexed-evidence',
      componentCount: 3,
      fileCount: Infinity,
      evidenceBytes: -1,
      rawComponents: [{ private: 'source contents' }],
    } as any);
    span.end();
    expect(events()[0].attributes).toEqual({ workerRole: 'indexed-evidence', componentCount: 3 });
    expect(JSON.stringify(events())).not.toContain('source contents');
  });

  it('captures transient thread memory and boundary deltas without aggregating shared RSS', () => {
    vi.useFakeTimers();
    vi.stubEnv('EDS_IMPORT_PROFILE_SAMPLE_INTERVAL_MS', '100');
    const observation = (heapUsed: number) => ({
      rss: 1000,
      heapUsed,
      heapTotal: 1000,
      external: heapUsed * 2,
      arrayBuffers: heapUsed,
    });
    const readMemory = vi.spyOn(process, 'memoryUsage').mockReturnValue(observation(10));
    const span = startImportProfileSpan('transient');
    readMemory.mockReturnValue(observation(90));
    vi.advanceTimersByTime(100);
    readMemory.mockReturnValue(observation(5));
    span.end();
    expect(events()[1]).toMatchObject({
      peakThreadMemory: { heapUsedBytes: 90, externalBytes: 180, arrayBufferBytes: 90 },
      boundaryMemoryDelta: { heapUsedBytes: -5, externalBytes: -10, arrayBufferBytes: -5 },
      sampling: { intervalMs: 100, periodicSamples: 1, failures: 0 },
    });
    expect(events()[1].peakThreadMemory).not.toHaveProperty('rssBytes');
    expect(vi.getTimerCount()).toBe(0);
    expect(events()).toHaveLength(2);
  });

  it('shares sampling reads across overlapping spans and releases the sampler after the last end', () => {
    vi.useFakeTimers();
    vi.stubEnv('EDS_IMPORT_PROFILE_SAMPLE_INTERVAL_MS', '100');
    const readMemory = vi.spyOn(process, 'memoryUsage');
    const first = startImportProfileSpan('first');
    const second = startImportProfileSpan('second');
    expect(vi.getTimerCount()).toBe(1);
    const reads = readMemory.mock.calls.length;
    vi.advanceTimersByTime(100);
    expect(readMemory.mock.calls.length - reads).toBe(1);
    first.end('cancelled');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(100);
    second.end('error');
    expect(vi.getTimerCount()).toBe(0);
    expect(events().filter((event) => event.type === 'span-end')).toMatchObject([
      { status: 'cancelled', sampling: { periodicSamples: 1 } },
      { status: 'error', sampling: { periodicSamples: 2 } },
    ]);
  });

  it('reports boundary-only coverage for synchronous work and rejects unsafe cadence values', () => {
    vi.useFakeTimers();
    vi.stubEnv('EDS_IMPORT_PROFILE_SAMPLE_INTERVAL_MS', '0');
    profileImportSync('sync', () => 42);
    expect(events()[1].sampling).toEqual({ intervalMs: 250, periodicSamples: 0, failures: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains observation failures and still releases cancellation ownership', () => {
    vi.useFakeTimers();
    vi.stubEnv('EDS_IMPORT_PROFILE_SAMPLE_INTERVAL_MS', '100');
    const readMemory = vi.spyOn(process, 'memoryUsage');
    const span = startImportProfileSpan('cancelled');
    readMemory.mockImplementationOnce(() => {
      throw new Error('measurement failed');
    });
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    span.end('cancelled');
    expect(events()[1]).toMatchObject({ status: 'cancelled', sampling: { periodicSamples: 0, failures: 1 } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the sampler when writing an end marker fails', () => {
    vi.useFakeTimers();
    const span = startImportProfileSpan('storage-unavailable');
    rmSync(directory, { recursive: true });
    expect(() => span.end('interrupted')).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts numeric byte budgets and cardinality without visiting evidence objects', () => {
    const attributes = {
      inputBytes: 100,
      parsedBytes: 200,
      transferBytes: 300,
      residentBytes: 400,
      budgetBytes: 500,
      reservedBytes: 600,
      recordCount: 7,
      compilerContextCount: 2,
      invalid: {
        toJSON() {
          throw new Error('must not serialize');
        },
      },
    };
    startImportProfileSpan('bytes', attributes).end();
    expect(events()[0].attributes).toEqual({
      inputBytes: 100,
      parsedBytes: 200,
      transferBytes: 300,
      residentBytes: 400,
      budgetBytes: 500,
      reservedBytes: 600,
      recordCount: 7,
      compilerContextCount: 2,
    });
  });
});

describe('automatic backend profiling', () => {
  it('records ordinary import spans beside the pipeline database without a profiling command', () => {
    vi.stubEnv('EDS_IMPORT_PROFILE_DIR', undefined);
    vi.stubEnv('EDS_PIPELINE_DB_PATH', join(directory, 'custom', 'pipeline.db'));
    profileImportSync('ordinary-import', () => 42);
    const output = join(directory, 'custom', 'import-diagnostics');
    expect(importProfileDirectory()).toBe(output);
    expect(events(output)).toMatchObject([
      { type: 'span-start', name: 'ordinary-import' },
      { type: 'span-end', name: 'ordinary-import', status: 'success' },
    ]);
    expect(events(output)[1]).toMatchObject({ wallMs: expect.any(Number), processCpuMs: expect.any(Number) });
    expect(events(output)[1].memory.heapUsedBytes).toBeGreaterThan(0);
    expect(process.env.EDS_IMPORT_PROFILE_DIR).toBeUndefined();
  });

  it('uses the standard configuration home when the database path is not overridden', () => {
    vi.stubEnv('EDS_IMPORT_PROFILE_DIR', undefined);
    profileImportSync('default-import', () => 42);
    expect(importProfileDirectory()).toBe(join(directory, 'default', 'import-diagnostics'));
    expect(events(importProfileDirectory())).toHaveLength(2);
  });

  it('saves generation memory-bound observations to the same automatic diagnostics directory', async () => {
    const { withGenerationMemoryObservation, observeGenerationMemoryBound } =
      await import('../../src/memory/generation-memory-mode.js');
    vi.stubEnv('EDS_IMPORT_PROFILE_DIR', undefined);
    const output = join(directory, 'default', 'import-diagnostics');
    withGenerationMemoryObservation(() =>
      observeGenerationMemoryBound({
        bound: 'parent-pressure',
        scope: 'request',
        operation: 'indexExploration',
        observedBytes: 2000,
        limitBytes: 1000,
      }),
    );
    expect(events(output)).toMatchObject([
      { type: 'generation-memory-bound-exceeded', bound: 'parent-pressure', observedBytes: 2000, limitBytes: 1000 },
    ]);
  });

  it('uses an operation-local directory without modifying the environment', async () => {
    vi.stubEnv('EDS_IMPORT_PROFILE_DIR', undefined);
    await withImportProfileDirectory(directory, async () => {
      await profileImportAsync('automatic', async () => 42);
    });
    expect(events()).toMatchObject([{ name: 'automatic' }, { name: 'automatic', status: 'success' }]);
    expect(process.env.EDS_IMPORT_PROFILE_DIR).toBeUndefined();
    profileImportSync('outside', () => 42);
    expect(events()).toHaveLength(2);
  });

  it('honors explicit disablement and keeps measurement values bounded and numeric', () => {
    vi.stubEnv('EDS_IMPORT_PROFILE_DIR', '');
    withImportProfileDirectory(directory, () => profileImportSync('disabled', () => 42));
    expect(events()).toEqual([]);
    vi.stubEnv('EDS_IMPORT_PROFILE_DIR', directory);
    const span = startImportProfileSpan('digest');
    span.end('success', { indexLookupMs: 1.25, fileReadMs: -1, secret: 'private' } as any);
    expect(events()[1].work).toEqual({ indexLookupMs: 1.25 });
  });
});

it('links nested work to its owning component span', () => {
  profileImportSync('raw-components.load', () => profileImportSync('raw-components.facts.validate', () => 42), {
    component: 'Card',
  });
  const records = events();
  const owner = records.find((event) => event.type === 'span-start' && event.name === 'raw-components.load');
  const child = records.find((event) => event.type === 'span-start' && event.name === 'raw-components.facts.validate');
  expect(child.parentId).toBe(owner.id);
  expect(owner.attributes.component).toBe('Card');
});
