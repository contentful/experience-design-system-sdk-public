import { statSync } from 'node:fs';
import path from 'node:path';
import type { CollectFilesOptions, CollectFilesOutcome, CollectFilesResult } from '../../types/collect-files-result.js';
import { buildScanWarnings } from './build-scan-warnings.js';
import { classifyStatError } from './classify-stat-error.js';
import { emptyFileCounts } from './empty-file-counts.js';
import { walkProjectTree } from './walk-project-tree.js';

/**
 * Walk a project directory and return everything downstream needs:
 *   - `filePaths` for the extractor framework-adapters
 *   - `counts` and `warnings` for a UI summary
 *   - optionally `candidateFiles` with pre-read content
 *
 * No throws — every failure mode lands in `{ ok: false, failure }` so UIs
 * can render a specific message per code.
 */
export function collectFiles(root: string, options: CollectFilesOptions = {}): CollectFilesOutcome {
  const resolved = path.resolve(root);
  let stat;
  try {
    stat = statSync(resolved);
  } catch (err) {
    return { ok: false, failure: classifyStatError((err as NodeJS.ErrnoException).code), rootPath: resolved };
  }
  if (stat.isFile()) return { ok: false, failure: 'is-file', rootPath: resolved };
  if (!stat.isDirectory()) return { ok: false, failure: 'not-directory', rootPath: resolved };

  const result: CollectFilesResult = {
    filePaths: [],
    counts: emptyFileCounts(),
    warnings: [],
    rootPath: resolved,
  };
  if (options.includeContent) result.candidateFiles = [];

  walkProjectTree(resolved, result, options.includeContent === true);
  result.filePaths.sort();
  if (result.candidateFiles) result.candidateFiles.sort((a, b) => a.path.localeCompare(b.path));
  result.warnings.push(...buildScanWarnings(result.counts));
  return { ok: true, result };
}
