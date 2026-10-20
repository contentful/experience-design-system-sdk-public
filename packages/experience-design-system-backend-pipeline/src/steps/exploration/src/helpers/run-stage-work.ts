import { runWithPool } from '../../../../orchestrators/run-generate-components-session/helpers/run-with-pool.js';

/** Drain started work and keep results in assignment order after a stage fails. */
export async function runStageWork<T, R extends { ok: boolean }>(
  work: T[],
  concurrency: number | undefined,
  worker: (work: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<Array<R | undefined>> {
  const requested = concurrency ?? 1;
  if (!Number.isInteger(requested) || requested < 1) throw new Error('Invalid stage concurrency budget');
  let stopped = false;
  return runWithPool(
    work,
    Math.min(requested, 8, work.length),
    async (item) => {
      if (stopped) return undefined;
      try {
        const result = await worker(item);
        if (!result.ok) stopped = true;
        return result;
      } catch (error) {
        stopped = true;
        throw error;
      }
    },
    signal,
  );
}
