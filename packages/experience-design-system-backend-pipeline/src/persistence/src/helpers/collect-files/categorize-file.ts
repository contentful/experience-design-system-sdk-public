import path from 'node:path';
import type { FileCounts } from '../../types/collect-files-result.js';

const CATEGORY_BY_EXTENSION: Record<string, keyof Omit<FileCounts, 'total'>> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.vue': 'vue',
  '.astro': 'astro',
  '.svelte': 'svelte',
  '.jsx': 'jsx',
  '.js': 'js',
  '.json': 'json',
  '.md': 'md',
};

/**
 * Bucket a filename into one of the FileCounts categories. `.d.ts` falls
 * through to `other` because it's a type declaration, not source.
 */
export function categorizeFile(name: string): keyof Omit<FileCounts, 'total'> {
  if (name.endsWith('.d.ts')) return 'other';
  const ext = path.extname(name);
  return CATEGORY_BY_EXTENSION[ext] ?? 'other';
}

export function emptyFileCounts(): FileCounts {
  return { tsx: 0, ts: 0, vue: 0, astro: 0, svelte: 0, jsx: 0, js: 0, json: 0, md: 0, other: 0, total: 0 };
}
