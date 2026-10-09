import type { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import { foldSvelteAndMdIntoOther } from './fold-svelte-and-md-into-other.js';
import type { ScanResult } from '../logic.js';

type CollectedFilesOutcome = ReturnType<typeof collectFiles>;

export function toScanResult(outcome: CollectedFilesOutcome): ScanResult {
  if (!outcome.ok) return { ok: false, failure: outcome.failure };
  return {
    ok: true,
    counts: foldSvelteAndMdIntoOther(outcome.result.counts),
    filePaths: outcome.result.filePaths,
    warnings: outcome.result.warnings,
  };
}
