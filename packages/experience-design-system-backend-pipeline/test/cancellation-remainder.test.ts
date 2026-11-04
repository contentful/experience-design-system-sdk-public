import { describe, expect, it, vi } from 'vitest';
import { runWithPool } from '../src/orchestrators/run-generate-components-session/helpers/run-with-pool.js';
import { retryDatabaseWrite } from '../src/orchestrators/run-extract-and-compose-session/helpers/retry-database-write.js';

describe('cancellation remainder — backend controls', () => {
  it('stops dequeuing after abort and drains active component workers', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const pool = runWithPool as unknown as (
      items: number[],
      concurrency: number,
      worker: (item: number, index: number, signal?: AbortSignal) => Promise<number>,
      signal: AbortSignal,
    ) => Promise<number[]>;

    const running = pool(
      [1, 2, 3],
      2,
      async (item) => {
        started.push(item);
        if (item < 3) await new Promise<void>((resolve) => releases.push(resolve));
        return item;
      },
      controller.signal,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    releases.forEach((release) => release());

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toEqual([1, 2]);
  });

  it('keeps the component already committed before abort and does not start a later one', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const committed: number[] = [];
    let releaseSecond!: () => void;
    const pool = runWithPool as unknown as (
      items: number[],
      concurrency: number,
      worker: (item: number, index: number, signal?: AbortSignal) => Promise<number>,
      signal: AbortSignal,
    ) => Promise<number[]>;

    const running = pool(
      [1, 2, 3],
      2,
      async (item, _index, signal) => {
        started.push(item);
        if (item === 1) {
          committed.push(item);
          return item;
        }
        controller.abort();
        await new Promise<void>((resolve) => (releaseSecond = resolve));
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        committed.push(item);
        return item;
      },
      controller.signal,
    );
    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    await vi.waitFor(() => expect(committed).toEqual([1]));

    releaseSecond();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toEqual([1, 2]);
    expect(committed).toEqual([1]);
  });

  it('does not retry a SQLite write after cancellation during the failed attempt', async () => {
    const controller = new AbortController();
    const operation = vi.fn(() => {
      controller.abort();
      throw new Error('database is locked');
    });
    const retry = retryDatabaseWrite as unknown as (
      operation: () => void,
      attempts: number,
      signal: AbortSignal,
    ) => Promise<void>;

    await expect(retry(operation, 4, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('clears retry backoff on cancellation before the next write attempt', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const operation = vi.fn(() => {
        throw new Error('database is locked');
      });
      const retry = retryDatabaseWrite as unknown as (
        operation: () => void,
        attempts: number,
        signal: AbortSignal,
      ) => Promise<void>;

      const running = retry(operation, 4, controller.signal);
      expect(operation).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();

      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
      expect(operation).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
