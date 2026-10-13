/**
 * Retry a database write when SQLite reports the DB is locked/busy. Backs off
 * from 250ms up to 2s, up to `attempts` times. Any other error throws
 * immediately.
 */
export async function retryDatabaseWrite<T>(operation: () => T, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is locked|database is busy/i.test(message) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 2000)));
    }
  }
}
