import type { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import { foldSvelteAndMdIntoOther } from './fold-svelte-and-md-into-other.js';
import type { ScanResult } from '../logic.js';

type CollectedFilesOutcome = ReturnType<typeof collectFiles>;

/**
 * Map the pipeline's walker outcome to the screen's `ScanResult` shape:
 * fold svelte + md counts into `other` for display, forward failures as-is,
 * and keep `filePaths` on the ok variant so the next step can reuse them
 * without re-walking.
 */
export function toScanResult(collectedFilesOutcome: CollectedFilesOutcome): ScanResult {
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
