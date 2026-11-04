import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { createAbortError, throwIfAborted } from '../helpers/abort.js';
import type { ExtractionEndpointProgress } from '../steps/extraction/src/types/contract.js';
import type { SourceAnalysisReply, SourceAnalysisTasks } from './types.js';

/** Read workers stop immediately on cancellation; publication joins its atomic write before settling. */
export async function runSourceAnalysis<K extends keyof SourceAnalysisTasks>(
  kind: K,
  input: SourceAnalysisTasks[K]['input'],
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ExtractionEndpointProgress) => void;
    onActivity?: (activity: string) => void;
  } = {},
): Promise<SourceAnalysisTasks[K]['output']> {
  throwIfAborted(options.signal);
  const writesSession = kind === 'publishExtraction' || kind === 'storeExtraction';
  return new Promise((resolve, reject) => {
    // The compiled backend has a sibling worker; a bundled CLI uses the installed backend artifact.
    const sibling = new URL('./worker.js', import.meta.url);
    const entry = existsSync(sibling)
      ? sibling
      : new URL(
          './source-analysis/worker.js',
          import.meta.resolve('@contentful/experience-design-system-backend-pipeline'),
        );
    const worker = new Worker(entry, { workerData: { kind, input } });
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      void worker.terminate().then(complete, reject);
    };
    const fail = (error: unknown): void => finish(() => reject(error));
    const onAbort = (): void => {
      // Publication must finish or roll back its transaction before the caller can release the session.
      if (!writesSession) fail(createAbortError(options.signal?.reason));
    };
    worker.on('message', (message: SourceAnalysisReply<K>) => {
      if (settled) return;
      try {
        if (!writesSession) throwIfAborted(options.signal);
        switch (message.kind) {
          case 'activity':
            options.onActivity?.(message.activity);
            break;
          case 'progress':
            options.onProgress?.(message.progress);
            break;
          case 'result':
            finish(() => {
              if (options.signal?.aborted) reject(createAbortError(options.signal.reason));
              else resolve(message.result);
            });
            break;
          case 'error':
            fail(Object.assign(new Error(message.error.message), { name: message.error.name }));
            break;
        }
      } catch (error) {
        fail(error);
      }
    });
    worker.on('error', fail);
    worker.on('exit', (code) => fail(new Error(`Source analysis exited before returning a result (code ${code}).`)));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}
