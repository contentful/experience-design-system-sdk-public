import type { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import type { FileCounts as LocalFileCounts } from '../logic.js';

type CollectedFilesOutcome = ReturnType<typeof collectFiles>;
type PipelineFileCounts = Extract<CollectedFilesOutcome, { ok: true }>['result']['counts'];

/**
 * The pipeline tracks `svelte` and `md` as their own buckets; this screen
 * does not render those rows yet. Fold them into `other` for display so
 * the total stays consistent with what the user sees.
 */
export function foldSvelteAndMdIntoOther(counts: PipelineFileCounts): LocalFileCounts {
  return {
    tsx: counts.tsx,
    ts: counts.ts,
    vue: counts.vue,
    astro: counts.astro,
    jsx: counts.jsx,
    js: counts.js,
    json: counts.json,
    other: counts.other + counts.svelte + counts.md,
    total: counts.total,
  };
}
