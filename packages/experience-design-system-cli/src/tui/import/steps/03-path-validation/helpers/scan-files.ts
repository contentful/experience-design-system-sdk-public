import { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import type { ScanResult } from '../logic.js';

export function scanFiles(directory: string): ScanResult {
  const outcome = collectFiles(directory);
  if (!outcome.ok) {
    return { ok: false, failure: outcome.failure };
  }
  const { counts, filePaths, warnings } = outcome.result;
  return {
    ok: true,
    counts: {
      tsx: counts.tsx,
      ts: counts.ts,
      vue: counts.vue,
      astro: counts.astro,
      jsx: counts.jsx,
      js: counts.js,
      json: counts.json,
      other: counts.other + counts.svelte + counts.md,
      total: counts.total,
    },
    filePaths,
    warnings,
  };
}
