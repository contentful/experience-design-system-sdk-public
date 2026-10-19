export function createAbortError(reason?: unknown): Error {
  const error = new Error('The operation was aborted.', reason === undefined ? undefined : { cause: reason });
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError(signal.reason);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export interface ImportAttempt {
  id: number;
  controller: AbortController;
}

export function isCurrentImportAttempt(current: ImportAttempt | undefined, candidate: ImportAttempt): boolean {
  return current === candidate && !candidate.controller.signal.aborted;
}

export interface ImportAttemptOwner {
  begin(): ImportAttempt;
  cancel(): void;
  isCurrent(attempt: ImportAttempt): boolean;
  current(): ImportAttempt | undefined;
}

const activeAttemptControllers = new Set<AbortController>();
const activeImportWork = new Set<Promise<unknown>>();

export function createImportAttemptOwner(): ImportAttemptOwner {
  let sequence = 0;
  let active: ImportAttempt | undefined;
  return {
    begin: () => {
      if (active) activeAttemptControllers.delete(active.controller);
      active?.controller.abort();
      active = { id: ++sequence, controller: new AbortController() };
      activeAttemptControllers.add(active.controller);
      return active;
    },
    cancel: () => {
      const previous = active;
      active = undefined;
      if (previous) activeAttemptControllers.delete(previous.controller);
      previous?.controller.abort();
    },
    isCurrent: (attempt) => isCurrentImportAttempt(active, attempt),
    current: () => active,
  };
}

export async function awaitForCurrentImportAttempt<T>(
  attempt: ImportAttempt,
  isCurrent: (attempt: ImportAttempt) => boolean,
  operation: () => Promise<T>,
): Promise<{ current: false } | { current: true; value: T }> {
  if (!isCurrent(attempt)) return { current: false };
  const value = await operation();
  return isCurrent(attempt) ? { current: true, value } : { current: false };
}

export function trackImportWork<T>(work: Promise<T>): Promise<T> {
  activeImportWork.add(work);
  void work.then(
    () => activeImportWork.delete(work),
    () => activeImportWork.delete(work),
  );
  return work;
}

export async function cancelAndDrainImportWork(): Promise<void> {
  for (const controller of activeAttemptControllers) controller.abort();
  activeAttemptControllers.clear();
  while (activeImportWork.size > 0) await Promise.allSettled([...activeImportWork]);
}

export function linkAbortSignal(parent?: AbortSignal): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  if (!parent) return { controller, dispose: () => {} };

  const abort = (): void => controller.abort(parent.reason);
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) abort();

  return { controller, dispose: () => parent.removeEventListener('abort', abort) };
}

export function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = (): void => finish(() => reject(createAbortError(signal.reason)));

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}
