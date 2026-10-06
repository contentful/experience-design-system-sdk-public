import type { RunGenerationServiceOptions, RunGenerationServiceResult } from '../types/contract.js';

// TODO (INTEG-5030): implement generation service.
// Needed: decouple invokeComponentAgent from SQLite — applyToolCalls, copyComponentFromCache,
// storeCache, renameEmptySlots, loadComponentSourceRef all write to or read from the DB.
// Replace with injectable callbacks (onCacheLookup, onCacheStore) and return CDFComponentEntry[]
// directly instead of persisting to DB. Run agents concurrently via worker pool (options.concurrency).

export async function runGenerationService(
  _options: RunGenerationServiceOptions,
): Promise<RunGenerationServiceResult> {
  throw new Error('runGenerationService not yet implemented — see INTEG-5030');
}
