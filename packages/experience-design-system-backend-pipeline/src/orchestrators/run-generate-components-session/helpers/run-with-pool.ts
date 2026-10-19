import { throwIfAborted } from '../../../helpers/abort.js';

export async function runWithPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number, signal?: AbortSignal) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  throwIfAborted(signal);
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (!signal?.aborted && next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i, signal);
    }
  }
  const settled = await Promise.allSettled(Array.from({ length: concurrency }, run));
  throwIfAborted(signal);
  const failed = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}
