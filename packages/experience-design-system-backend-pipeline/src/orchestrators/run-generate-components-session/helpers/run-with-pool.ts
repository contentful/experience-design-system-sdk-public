/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once.
 * Results come back in the same order as `items`. Mirrors the legacy
 * `__generate components` worker pool.
 */
export async function runWithPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}
