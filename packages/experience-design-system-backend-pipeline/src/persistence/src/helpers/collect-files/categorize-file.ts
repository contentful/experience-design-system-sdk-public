import path from 'node:path';
import { CATEGORY_BY_EXTENSION } from '../../constants/file-categories.js';
import type { FileCounts } from '../../types/collect-files-result.js';

/**
 * Bucket a filename into one of the FileCounts categories. `.d.ts` falls
 * through to `other` because it's a type declaration, not source.
 */
export function categorizeFile(name: string): keyof Omit<FileCounts, 'total'> {
  if (name.endsWith('.d.ts')) return 'other';
  const ext = path.extname(name);
  return CATEGORY_BY_EXTENSION[ext] ?? 'other';
}
