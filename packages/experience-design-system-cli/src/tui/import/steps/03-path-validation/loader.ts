import { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import type { FileCounts as LocalFileCounts, ScanResult } from './logic.js';

type CollectFilesOutcome = ReturnType<typeof collectFiles>;
type PipelineFileCounts = Extract<CollectFilesOutcome, { ok: true }>['result']['counts'];

/**
 * Scan the project path using the pipeline's walker so counts shown here
 * match exactly what extract will later walk. Keeps the file list on the ok
 * variant so downstream screens can consume `filePaths` without re-walking.
 */
export async function scanProject(directory: string): Promise<ScanResult> {
  const outcome = collectFiles(directory);
  return toScanResult(outcome);
}

function toScanResult(outcome: CollectFilesOutcome): ScanResult {
  if (!outcome.ok) {
    return { ok: false, failure: outcome.failure };
  }
  return {
    ok: true,
    counts: foldSvelteAndMdIntoOther(outcome.result.counts),
    filePaths: outcome.result.filePaths,
    warnings: outcome.result.warnings,
  };
}

/**
 * The pipeline tracks `svelte` and `md` as their own buckets; this screen
 * does not render those rows yet. Fold them into `other` for display so the
 * total stays consistent with what the user sees.
 */
function foldSvelteAndMdIntoOther(counts: PipelineFileCounts): LocalFileCounts {
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
