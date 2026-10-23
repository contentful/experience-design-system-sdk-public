import type { DatabaseSync } from 'node:sqlite';
import { storeExtractCache } from '../../../persistence/src/session/repositories/db.js';
import { hashFile } from '../../../persistence/src/session/helpers/cache-keys.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';

/**
 * Persist one extract-cache row per source file, grouping components by their
 * `sourcePath`. Called on the cache-miss path only — when every file was a hit,
 * the cache is already warm and this is a no-op by the caller.
 */
export async function persistExtractCache(
  db: DatabaseSync,
  sourceFiles: string[],
  components: RawComponentDefinition[],
  cacheVersion: string,
): Promise<void> {
  const componentsBySourcePath = new Map<string, RawComponentDefinition[]>();
  for (const component of components) {
    if (!component.sourcePath) continue;
    const existing = componentsBySourcePath.get(component.sourcePath) ?? [];
    existing.push(component);
    componentsBySourcePath.set(component.sourcePath, existing);
  }
  for (const filePath of sourceFiles) {
    storeExtractCache(db, filePath, await hashFile(filePath), cacheVersion, componentsBySourcePath.get(filePath) ?? []);
  }
}
