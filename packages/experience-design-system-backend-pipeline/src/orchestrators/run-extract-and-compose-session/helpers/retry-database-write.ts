import { abortableDelay, throwIfAborted } from '../../../helpers/abort.js';

/**
 * Retry a database write when SQLite reports the DB is locked/busy. Backs off
 * from 250ms up to 2s, up to `attempts` times. Any other error throws
 * immediately — only SQLITE_BUSY / SQLITE_LOCKED trigger the retry.
 */
export async function retryDatabaseWrite<T>(operation: () => T, attempts = 8, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(signal);
    try {
      const result = operation();
      throwIfAborted(signal);
      return result;
    } catch (error) {
      throwIfAborted(signal);
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is locked|database is busy/i.test(message) || attempt >= attempts) throw error;
      await abortableDelay(Math.min(250 * attempt, 2000), signal);
    }
  }
}
