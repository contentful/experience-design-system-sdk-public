import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IGNORED_DIRS } from '../../constants/file-patterns.js';
import type { CollectFilesResult } from '../../types/collect-files-result.js';
import { categorizeFile } from './categorize-file.js';
import { isSourceFile } from './is-source-file.js';
import { readDirSafely } from './read-dir-safely.js';

/**
 * Recursive directory walker. Mutates `result` in place with every passing
 * file: appends to `filePaths`, increments the matching bucket in `counts`,
 * optionally reads content when `includeContent` is on.
 *
 * Unreadable directories are skipped with an entry in `result.warnings`
 * rather than aborting the whole scan.
 */
export function walkProjectTree(dir: string, result: CollectFilesResult, includeContent: boolean): void {
  const entries = readDirSafely(dir);
  if (entries === 'unreadable') {
    result.warnings.push(`Could not read directory: ${dir}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walkProjectTree(full, result, includeContent);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isSourceFile(entry.name)) continue;
    const category = categorizeFile(entry.name);
    result.counts[category] += 1;
    result.counts.total += 1;
    result.filePaths.push(full);
    if (includeContent) {
      try {
        const content = readFileSync(full, 'utf8');
        (result.candidateFiles ??= []).push({ path: full, content });
      } catch {
        // Pre-read failed but the path is still valid — downstream extractor
        // will try again and surface the real error.
      }
    }
  }
}
