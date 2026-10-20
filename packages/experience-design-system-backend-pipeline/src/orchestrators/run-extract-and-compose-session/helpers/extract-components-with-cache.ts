import type { DatabaseSync } from 'node:sqlite';
import { extractComponents } from '../../../steps/extraction/src/controller/extract-components-endpoint.js';
import { lookupExtractCache } from '../../../persistence/src/session/repositories/db.js';
import { hashFile } from '../../../persistence/src/session/helpers/cache-keys.js';
import type { AgentDebugEvent } from '../../../agents/types/agent-run.js';
import type { ExtractAndComposeProgress } from '../types.js';

type Extraction = Awaited<ReturnType<typeof extractComponents>>;

export interface ExtractComponentsWithCacheRequest {
  db: DatabaseSync;
  sourceFiles: string[];
  evidenceFilePaths?: readonly string[];
  projectPath: string;
  cacheVersion: string;
  noCache: boolean;
  resolveUnreachable: 'auto' | 'always' | 'never';
  onProgress?: (event: ExtractAndComposeProgress) => void;
  onDebugEvent?: AgentDebugEvent;
}

export interface ExtractComponentsWithCacheResult {
  extraction: Extraction;
  /** Number of source files that came back from cache. 0 when the extractor ran. */
  cacheHits: number;
}

/**
 * Returns extraction results for the given source files, either from the
 * per-file extract cache or by running the extractor. All-or-nothing on cache:
 * if any file has a miss (or `noCache` is true), the extractor runs over the
 * full set and no cache hits are reported.
 */
export async function extractComponentsWithCache({
  db,
  sourceFiles,
  evidenceFilePaths,
  projectPath,
  cacheVersion,
  noCache,
  resolveUnreachable,
  onProgress,
  onDebugEvent,
}: ExtractComponentsWithCacheRequest): Promise<ExtractComponentsWithCacheResult> {
  const cachedByPath = new Map<string, ReturnType<typeof lookupExtractCache>>();
  if (!noCache && sourceFiles.length > 0) {
    const hashes = await Promise.all(sourceFiles.map(async (p) => [p, await hashFile(p)] as const));
    for (const [p, h] of hashes) cachedByPath.set(p, lookupExtractCache(db, h, cacheVersion));
  }

  const allFilesCached = !noCache && sourceFiles.length > 0 && sourceFiles.every((p) => cachedByPath.get(p) !== null);

  if (allFilesCached) {
    const cachedComponents = sourceFiles.flatMap((p) => cachedByPath.get(p)!.components);
    onProgress?.({
      kind: 'extract',
      done: sourceFiles.length,
      total: sourceFiles.length,
      componentsSoFar: cachedComponents.length,
    });
    onDebugEvent?.('analyze', {
      kind: 'extract.cache-hit',
      files: sourceFiles.length,
      components: cachedComponents.length,
    });
    return {
      extraction: { components: cachedComponents, warnings: [], exclusions: [] },
      cacheHits: sourceFiles.length,
    };
  }

  const extraction = await extractComponents({
    filePaths: sourceFiles,
    projectRoot: projectPath,
    opts: { resolveUnreachable, evidenceFilePaths },
    onProgress: ({ filesProcessed, componentsFound }) => {
      onProgress?.({
        kind: 'extract',
        done: filesProcessed,
        total: sourceFiles.length,
        componentsSoFar: componentsFound,
      });
    },
  });
  return { extraction, cacheHits: 0 };
}
