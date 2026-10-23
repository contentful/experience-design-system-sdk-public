import type { FileCounts } from '../types/collect-files-result.js';

/**
 * File extension → `FileCounts` bucket. Any extension not listed here falls
 * through to `other` in `categorizeFile`.
 */
export const CATEGORY_BY_EXTENSION: Record<string, keyof Omit<FileCounts, 'total'>> = {
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
