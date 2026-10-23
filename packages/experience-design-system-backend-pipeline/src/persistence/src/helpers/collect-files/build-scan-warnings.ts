import type { FileCounts } from '../../types/collect-files-result.js';

/**
 * Advisory messages derived from a completed walk. Returns an empty array
 * when the project looks healthy (any framework source files present).
 */
export function buildScanWarnings(counts: FileCounts): string[] {
  const warnings: string[] = [];
  if (counts.total === 0) {
    warnings.push('No source files found. Double-check the path points at your component code.');
    return warnings;
  }
  const frameworkFiles = counts.tsx + counts.ts + counts.jsx + counts.js + counts.vue + counts.astro + counts.svelte;
  if (frameworkFiles === 0) {
    warnings.push('No framework source files found (.tsx, .ts, .vue, .svelte, .astro, .jsx, .js).');
  }
  return warnings;
}
