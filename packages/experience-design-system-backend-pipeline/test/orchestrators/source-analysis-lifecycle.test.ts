import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';

const createWorker = vi.hoisted(() => vi.fn());
vi.mock('node:worker_threads', () => ({ Worker: createWorker }));
import { runSourceAnalysis } from '../../src/source-analysis/run.js';

let worker: EventEmitter & { terminate: ReturnType<typeof vi.fn> };
beforeEach(() => {
  createWorker.mockReset();
  worker = Object.assign(new EventEmitter(), { terminate: vi.fn().mockResolvedValue(0) });
  createWorker.mockImplementation(function () {
    return worker;
  });
});

const start = (signal?: AbortSignal, onProgress?: () => void) =>
  runSourceAnalysis('extract', { filePaths: [] }, { signal, onProgress });

it('forwards progress and waits for worker shutdown before returning results', async () => {
  let stopped!: () => void;
  worker.terminate.mockReturnValue(
    new Promise<void>((resolve) => {
      stopped = resolve;
    }),
  );
  const onProgress = vi.fn();
  let finished = false;
  const result = { components: [], warnings: [], exclusions: [] };
  const work = start(undefined, onProgress).then((value) => {
    finished = true;
    return value;
  });
  const progress = { phase: 'extract', filesProcessed: 1, componentsFound: 0 };
  worker.emit('message', { kind: 'progress', progress });
  expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress);
  worker.emit('message', { kind: 'result', result });
  worker.emit('exit', 0);
  await Promise.resolve();
  expect(finished).toBe(false);
  stopped();
  expect(await work).toEqual(result);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('terminates active work on cancellation and ignores late progress or success', async () => {
  const controller = new AbortController();
  const progress = vi.fn();
  const work = start(controller.signal, progress);
  controller.abort();
  worker.emit('message', { kind: 'progress', progress: {} });
  worker.emit('message', { kind: 'result', result: {} });
  await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  expect(progress).not.toHaveBeenCalled();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('joins atomic publication before acknowledging cancellation', async () => {
  const controller = new AbortController();
  const work = runSourceAnalysis(
    'publishExtraction',
    {
      dbPath: '/unused/pipeline.db',
      extraction: {} as Parameters<typeof runSourceAnalysis<'publishExtraction'>>[1]['extraction'],
    },
    { signal: controller.signal },
  );
  const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.emit('message', { kind: 'result', result: {} });
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('does not start a worker for an already cancelled operation', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(start(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(createWorker).not.toHaveBeenCalled();
});

it.each([0, 1])('rejects an exit without a result even when its code is %i', async (code) => {
  const work = start();
  worker.emit('exit', code);
  await expect(work).rejects.toThrow('before returning a result');
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('preserves a worker failure instead of reporting successful extraction', async () => {
  const work = start();
  worker.emit('message', { kind: 'error', error: { name: 'SourceError', message: 'Invalid source inventory' } });
  await expect(work).rejects.toMatchObject({ name: 'SourceError', message: 'Invalid source inventory' });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('stops the worker when a progress consumer throws', async () => {
  const work = start(undefined, () => {
    throw new Error('Progress failed');
  });
  worker.emit('message', { kind: 'progress', progress: {} });
  await expect(work).rejects.toThrow('Progress failed');
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('reports worker startup errors', async () => {
  createWorker.mockImplementation(function () {
    throw new Error('Worker unavailable');
  });
  await expect(start()).rejects.toThrow('Worker unavailable');
});
