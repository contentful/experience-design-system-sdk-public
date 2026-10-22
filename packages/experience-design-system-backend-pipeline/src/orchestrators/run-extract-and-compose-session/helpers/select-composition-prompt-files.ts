import {
  capCandidatesToPromptBudget,
  selectCandidateFiles,
} from '../../../steps/composition/src/helpers/candidates/candidate-files.js';
import { readCandidateFiles } from './read-candidate-files.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import type { SourceCapture } from '../../../steps/extraction/index.js';

export interface CompositionPromptFiles {
  /** Bounded candidate SAMPLE inlined into the agent prompt. */
  promptFiles: Array<{ path: string; content: string }>;
  /** EVERY scanned file, used for deterministic evidence (manifest/doc edges). */
  runtimeFiles: Array<{ path: string; content: string }>;
  /** When the candidate set was capped to fit the prompt budget, a user-visible warning. */
  droppedWarning: string | undefined;
}

/**
 * Build the two file sets the composition agent needs:
 *   - `promptFiles`: a bounded candidate SAMPLE so the agent sees the convention
 *     without ingesting the whole repo.
 *   - `runtimeFiles`: EVERY scanned file, for deterministic evidence passes
 *     (manifest/doc edges) that must not be starved by a candidate-filter miss.
 *
 * When the candidate set has to be dropped to fit the prompt budget, surfaces
 * a `droppedWarning` string for the caller to append to compositionWarnings.
 */
export async function selectCompositionPromptFiles(
  components: RawComponentDefinition[],
  sourceFiles: string[],
  sourceCapture?: SourceCapture,
): Promise<CompositionPromptFiles> {
  const allFiles = sourceCapture
    ? sourceCapture.files.flatMap((file) =>
        file.captured.kind === 'full' && file.roles.some((role) => role !== 'config')
          ? [{ path: file.canonicalPath, content: file.captured.text }]
          : [],
      )
    : await readCandidateFiles(components, sourceFiles);
  const selectedCandidates = selectCandidateFiles(allFiles).map((c) => ({ path: c.path, content: c.content }));
  const capped = capCandidatesToPromptBudget(selectedCandidates);
  const promptFiles = capped.kept;
  const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));
  const droppedWarning =
    capped.dropped.length > 0
      ? `composition — ${capped.dropped.length} candidate file(s) omitted from the agent prompt to fit the context budget; resolution runs on the ${promptFiles.length} highest-value files.`
      : undefined;
  return { promptFiles, runtimeFiles, droppedWarning };
}
