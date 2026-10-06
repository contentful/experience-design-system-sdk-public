import type { RawComponentDefinition } from '../../types.js';
import { extractEndpoint } from '@contentful/experience-design-system-extraction';
import { hashFile } from '../../session/cache-keys.js';
import { lookupExtractCache, storeExtractCache } from '../../session/db.js';
import type { openPipelineDb } from '../../session/db.js';
import { getDebugLogger } from '../../lib/debug-logger.js';

export interface ExtractionWithCacheOptions {
  db: ReturnType<typeof openPipelineDb>;
  sourceFiles: string[];
  noCache: boolean;
  resolveUnreachable?: 'auto' | 'always' | 'never';
  projectRoot?: string;
  cacheVersion: string;
  onProgress?: (filesProcessed: number) => void;
}

export interface ExtractionWithCacheResult {
  components: RawComponentDefinition[];
  warnings: string[];
  cacheHits: number;
}

async function callExtractEndpoint(options: ExtractionWithCacheOptions) {
  return extractEndpoint({
    filePaths: options.sourceFiles,
    ...(options.resolveUnreachable ? { resolveUnreachable: options.resolveUnreachable } : {}),
    ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
    onProgress: ({ filesProcessed }) => options.onProgress?.(filesProcessed),
  });
}

export async function runExtractionWithCache(options: ExtractionWithCacheOptions): Promise<ExtractionWithCacheResult> {
  const { db, sourceFiles, noCache, cacheVersion } = options;

  if (noCache || sourceFiles.length === 0) {
    const result = await callExtractEndpoint(options);
    return { ...result, cacheHits: 0 };
  }

  const hashes = await Promise.all(sourceFiles.map(async (filePath) => [filePath, await hashFile(filePath)] as const));
  const cachedByPath = new Map(
    hashes.map(([filePath, hash]) => [filePath, lookupExtractCache(db, hash, cacheVersion)]),
  );

  if (sourceFiles.every((f) => cachedByPath.get(f) !== null)) {
    const components = sourceFiles.flatMap((f) => cachedByPath.get(f)!.components);
    options.onProgress?.(sourceFiles.length);
    getDebugLogger().event('analyze', 'extract.cache-hit', {
      files: sourceFiles.length,
      components: components.length,
    });
    return { components, warnings: [], cacheHits: sourceFiles.length };
  }

  const result = await callExtractEndpoint(options);

  const bySourcePath = new Map<string, RawComponentDefinition[]>();
  for (const component of result.components) {
    if (!component.sourcePath) continue;
    const list = bySourcePath.get(component.sourcePath) ?? [];
    list.push(component);
    bySourcePath.set(component.sourcePath, list);
  }
  for (const [filePath, hash] of hashes) {
    storeExtractCache(db, filePath, hash, cacheVersion, bySourcePath.get(filePath) ?? []);
  }

  return { ...result, cacheHits: 0 };
}
