import { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import { foldSvelteAndMdIntoOther } from './helpers/fold-svelte-and-md-into-other.js';
import type { ScanResult } from './logic.js';

type CollectFilesOutcome = ReturnType<typeof collectFiles>;

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
