import { collectFiles, discoverSourceEvidence } from '@contentful/experience-design-system-backend-pipeline';
import type { FileCounts as LocalFileCounts, ScanResult } from '../logic.js';

type CollectedFilesOutcome = ReturnType<typeof collectFiles>;
type PipelineFileCounts = Extract<CollectedFilesOutcome, { ok: true }>['result']['counts'];

export function scanFiles(directory: string): ScanResult {
  return toScanResult(collectFiles(directory), directory);
}

function toScanResult(outcome: CollectedFilesOutcome, directory: string): ScanResult {
  if (!outcome.ok) return { ok: false, failure: outcome.failure };
  return {
    ok: true,
    counts: foldSvelteAndMdIntoOther(outcome.result.counts),
    filePaths: outcome.result.filePaths,
    warnings: outcome.result.warnings,
    sourceInventory: discoverSourceEvidence({ projectRoot: directory, filePaths: outcome.result.filePaths }),
  };
}

function foldSvelteAndMdIntoOther(counts: PipelineFileCounts): LocalFileCounts {
  const { svelte, md, ...rest } = counts;
  return { ...rest, other: rest.other + svelte + md };
}
