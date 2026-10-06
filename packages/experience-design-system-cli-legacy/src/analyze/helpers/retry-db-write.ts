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
