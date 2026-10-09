import type { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import type { FileCounts as LocalFileCounts } from '../logic.js';

type CollectedFilesOutcome = ReturnType<typeof collectFiles>;
type PipelineFileCounts = Extract<CollectedFilesOutcome, { ok: true }>['result']['counts'];

export function foldSvelteAndMdIntoOther(counts: PipelineFileCounts): LocalFileCounts {
  const { svelte, md, ...rest } = counts;
  return { ...rest, other: rest.other + svelte + md };
}
