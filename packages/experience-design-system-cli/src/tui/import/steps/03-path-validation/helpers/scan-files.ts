import { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import type { FileCounts as LocalFileCounts, ScanResult } from '../logic.js';

type CollectedFilesOutcome = ReturnType<typeof collectFiles>;
type PipelineFileCounts = Extract<CollectedFilesOutcome, { ok: true }>['result']['counts'];

export function scanFiles(directory: string): ScanResult {
  return toScanResult(collectFiles(directory));
}

function toScanResult(collectedFilesOutcome: CollectedFilesOutcome): ScanResult {
  if (!collectedFilesOutcome.ok) {
    return { ok: false, failure: collectedFilesOutcome.failure };
  }
  return {
    ok: true,
    counts: foldSvelteAndMdIntoOther(collectedFilesOutcome.result.counts),
    filePaths: collectedFilesOutcome.result.filePaths,
    warnings: collectedFilesOutcome.result.warnings,
  };
}

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
